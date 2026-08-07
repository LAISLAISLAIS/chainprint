/**
 * Apply a verified Stripe event to profiles (service role).
 * Process first, then record stripe_events — so Stripe retries still apply after transient failures.
 */

import { pastDueGraceUntil } from "./entitlements.mjs";
import { getStripe } from "./stripe.mjs";
import { supabaseServiceConfig } from "./supabase.mjs";

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

async function eventAlreadyProcessed(eventId) {
  const res = await rest(
    `/rest/v1/stripe_events?id=eq.${encodeURIComponent(eventId)}&select=id&limit=1`
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function recordEvent(event) {
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
    `/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id,plan,subscription_status,stripe_subscription_id&limit=1`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findProfileBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const res = await rest(
    `/rest/v1/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,plan,subscription_status,stripe_subscription_id&limit=1`
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

function checkoutPaymentOk(session) {
  const status = String(session.payment_status || "").toLowerCase();
  return status === "paid" || status === "no_payment_required";
}

async function handleCheckoutCompleted(session) {
  if (!checkoutPaymentOk(session)) {
    console.warn(
      "[stripe] checkout.session.completed ignored — payment_status=",
      session.payment_status
    );
    return;
  }
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
    const patch = {
      plan: "pro",
      subscription_status: "past_due",
      stripe_subscription_id: sub.id,
      grace_until: pastDueGraceUntil(),
    };
    if (customerId) patch.stripe_customer_id = customerId;
    await updateProfile(profile.id, patch);
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
  const fullRefund = charge.refunded || charge.amount_refunded >= charge.amount;
  if (!fullRefund) return;

  const subId = profile.stripe_subscription_id;
  if (subId) {
    const stripe = getStripe();
    if (stripe) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const live = ["active", "trialing", "past_due", "unpaid"].includes(sub.status);
        if (live) {
          // Don't silently revoke while Stripe still bills — cancel first, then revoke.
          await stripe.subscriptions.cancel(subId);
        }
      } catch (err) {
        // Already canceled / missing — still revoke local entitlement
        console.warn("[stripe] refund: subscription cancel skipped", err?.message || err);
      }
    }
  }
  await revokePro(profile.id, "refunded");
}

async function dispatchEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      return true;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      return true;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      return true;
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
      return true;
    }
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      return true;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      return true;
    default:
      return false;
  }
}

/**
 * @param {import('stripe').Stripe.Event} event
 * @returns {Promise<{ duplicate?: boolean, handled: boolean }>}
 */
export async function applyStripeEvent(event) {
  if (await eventAlreadyProcessed(event.id)) {
    return { duplicate: true, handled: true };
  }

  const handled = await dispatchEvent(event);
  if (!handled) {
    return { handled: false, duplicate: false };
  }

  // Record after successful apply so retries can re-apply if this insert never happened
  await recordEvent(event);
  return { handled: true, duplicate: false };
}

/** Test helper */
export const __testing = {
  grantPro,
  revokePro,
  handleCheckoutCompleted,
  handleSubscriptionDeleted,
  checkoutPaymentOk,
};
