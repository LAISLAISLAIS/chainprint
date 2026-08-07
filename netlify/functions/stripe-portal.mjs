import { corsHeaders, isOriginAllowed } from "./_shared/cors.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { getStripe } from "./_shared/stripe.mjs";
import {
  bearerFromEvent,
  getUserFromJwt,
  siteOrigin,
  supabaseServiceConfig,
} from "./_shared/supabase.mjs";

async function fetchCustomerId(userId) {
  const { url, key } = supabaseServiceConfig();
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0].stripe_customer_id : null;
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

  const stripe = getStripe();
  if (!stripe) return jsonError(503, "Billing is not configured yet.", null, cors);

  const token = bearerFromEvent(event);
  if (!token) return jsonError(401, "Sign in to manage billing.", null, cors);
  const user = await getUserFromJwt(token);
  if (!user?.id) return jsonError(401, "Session expired — sign in again.", null, cors);

  const rl = await rateLimit(event, {
    bucket: "stripe-portal",
    limit: 20,
    windowSec: 60,
    userId: user.id,
    requireShared: true,
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  try {
    const customerId = await fetchCustomerId(user.id);
    if (!customerId) {
      return jsonError(400, "No billing customer yet — upgrade first.", null, cors);
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteOrigin(event)}/settings/?billing=portal`,
    });
    return jsonResponse(200, { url: session.url }, cors);
  } catch (err) {
    return jsonError(502, "Could not open billing portal.", err, cors);
  }
}
