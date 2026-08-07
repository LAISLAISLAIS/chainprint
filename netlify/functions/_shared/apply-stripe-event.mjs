/**
 * Apply a verified Stripe event to profiles (service role).
 * Idempotent via stripe_events insert.
 */

import { supabaseServiceConfig } from "./supabase.mjs";
import { pastDueGraceUntil } from "./entitlements.mjs";

async function rest(path, { method = "GET", body, headers: extra } = {}) {
  const { url, key } = supabaseServiceConfig();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function claimEvent(event) {
  const res = await rest("/rest/v1/stripe_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: {
      id: event.id,
      type: event.type,
      processed_at: new Date().toISOString(),
    },
  });
  if (res.status === 409 || res.status === 23505) return { duplicate: true };
  if (!res.ok) {
    const text = await res.text();
    if (/duplicate|unique|23505/i.test(text)) return { duplicate: true };
    throw new Error(`stripe_events insert failed: ${res.status} ${text}`);
  }
  return { duplicate: false };
}

async function updateProfile(userId, patch) {
  const res = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { ...patch, updated_at: new Date().toISOString() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`profile update failed: ${res.status} ${text}`);
  }
}

async function findProfileByCustomer(customerId) {
  if (!customerId) return null;
  const res = await rest(
    `/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id,plan,subscription_status&limit=1`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findProfileBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const res = await rest(
    `/rest/v1/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,plan,subscription_status&limit=1`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function grantPro(userId, { customerId, subscriptionId, sessionId, status = "active" }) {
  const patch = {
    plan: "pro",
    analyses_included: null,
    subscription_status: status,
    grace_until: null,
  };
  if (customerId) patch.stripe_customer_id = customerId;
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
  if (sessionId) patch.stripe_session_id = sessionId;
  return updateProfile(userId, patch);
}

function revokePro(userId, status = "canceled") {
  return updateProfile(userId, {
    plan: "free",
    analyses_included: 1,
    subscription_status: status,
    stripe_subscription_id: null,
    grace_until: null,
  });
}

async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.userId || session.client_reference_id;
  if (!userId) throw new Error("checkout.session.completed missing userId metadata");
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  await grantPro(userId, {
    customerId,
    subscriptionId,
    sessionId: session.id,
    status: "active",
  });
}

async function handleSubscriptionUpdated(sub) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  let profile = await findProfileBySubscription(sub.id);
  if (!profile) profile = await findProfileByCustomer(customerId);
  if (!profile) {
    const userId = sub.metadata?.userId;
    if (!userId) return;
    profile = { id: userId };
  }

  const status = String(sub.status || "").toLowerCase();
  if (status === "active" || status === "trialing") {
    await grantPro(profile.id, {
      customerId,
      subscriptionId: sub.id,
      status,
    });
    return;
  }
  if (status === "past_due" || status === "unpaid") {
    await updateProfile(profile.id, {
      plan: "pro",
      subscription_status: "past_due",
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId || undefined,
      grace_until: pastDueGraceUntil(),
    });
    return;
  }
  if (status === "canceled" || status === "incomplete_expired") {
    await revokePro(profile.id, status);
  }
}

async function handleSubscriptionDeleted(sub) {
  const profile =
    (await findProfileBySubscription(sub.id)) ||
    (await findProfileByCustomer(
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id
    ));
  if (!profile) return;
  await revokePro(profile.id, "canceled");
}

async function handleInvoicePaymentFailed(invoice) {
  const subId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const profile =
    (await findProfileBySubscription(subId)) || (await findProfileByCustomer(customerId));
  if (!profile) return;
  await updateProfile(profile.id, {
    subscription_status: "past_due",
    grace_until: pastDueGraceUntil(),
  });
}

async function handleChargeRefunded(charge) {
  const customerId =
    typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  const profile = await findProfileByCustomer(customerId);
  if (!profile) return;
  // Full refund → revoke; partial leaves status (ops can fix via portal)
  if (charge.refunded || charge.amount_refunded >= charge.amount) {
    await revokePro(profile.id, "refunded");
  }
}

/**
 * @param {import('stripe').Stripe.Event} event
 * @returns {Promise<{ duplicate?: boolean, handled: boolean }>}
 */
export async function applyStripeEvent(event) {
  const claim = await claimEvent(event);
  if (claim.duplicate) return { duplicate: true, handled: true };

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;
    case "invoice.paid": {
      const inv = event.data.object;
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      const profile =
        (await findProfileBySubscription(subId)) || (await findProfileByCustomer(customerId));
      if (profile) {
        await updateProfile(profile.id, {
          plan: "pro",
          subscription_status: "active",
          grace_until: null,
          analyses_included: null,
        });
      }
      break;
    }
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      break;
    default:
      return { handled: false, duplicate: false };
  }
  return { handled: true, duplicate: false };
}

/** Test helper: apply without stripe_events claim */
export const __testing = {
  grantPro,
  revokePro,
  handleCheckoutCompleted,
  handleSubscriptionDeleted,
};
