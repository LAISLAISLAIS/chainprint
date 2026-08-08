import { corsHeaders, isOriginAllowed } from "./_shared/cors.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { priceIdForPlan } from "./_shared/plans.mjs";
import { getStripe, stripePublishableReady } from "./_shared/stripe.mjs";
import {
  bearerFromEvent,
  getUserFromJwt,
  siteOrigin,
  supabaseServiceConfig,
} from "./_shared/supabase.mjs";
import { hasProAccess } from "./_shared/entitlements.mjs";

async function fetchProfile(userId) {
  const { url, key } = supabaseServiceConfig();
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,plan,subscription_status,grace_until,stripe_customer_id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function saveCustomerId(userId, customerId) {
  const { url, key } = supabaseServiceConfig();
  await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }),
  });
}

export async function handler(event) {
  const cors = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonError(405, "Method not allowed", null, cors);
  }
  if (!isOriginAllowed(event)) {
    return jsonError(403, "Origin not allowed", null, cors);
  }
  if (!stripePublishableReady()) {
    return jsonError(503, "Billing is not configured yet.", null, cors);
  }

  const token = bearerFromEvent(event);
  if (!token) return jsonError(401, "Sign in to upgrade.", null, cors);
  const user = await getUserFromJwt(token);
  if (!user?.id) return jsonError(401, "Session expired — sign in again.", null, cors);

  const rl = await rateLimit(event, {
    bucket: "stripe-checkout",
    limit: 10,
    windowSec: 60,
    userId: user.id,
    requireShared: true,
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  let planId = "pro";
  try {
    const body = JSON.parse(event.body || "{}");
    if (body.plan) planId = String(body.plan);
  } catch {
    return jsonError(400, "Invalid JSON body.", null, cors);
  }

  const priceId = priceIdForPlan(planId);
  if (!priceId) return jsonError(400, "Unknown or unpriced plan.", null, cors);

  let profile;
  try {
    profile = await fetchProfile(user.id);
  } catch (err) {
    return jsonError(503, "Billing backend unavailable.", err, cors);
  }

  if (profile && hasProAccess(profile)) {
    return jsonError(409, "You already have an active Pro plan.", null, cors);
  }

  const stripe = getStripe();
  const origin = siteOrigin(event);

  try {
    let customerId = profile?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email || user.email || undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await saveCustomerId(user.id, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/settings/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings/?billing=cancel`,
      allow_promotion_codes: true,
      metadata: { userId: user.id, plan: planId },
      subscription_data: { metadata: { userId: user.id, plan: planId } },
    });

    return jsonResponse(200, { url: session.url, id: session.id }, cors);
  } catch (err) {
    return jsonError(502, "Could not start checkout.", err, cors);
  }
}
