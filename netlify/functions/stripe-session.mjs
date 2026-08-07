import { applyStripeEvent } from "./_shared/apply-stripe-event.mjs";
import { corsHeaders, isOriginAllowed } from "./_shared/cors.mjs";
import { hasProAccess } from "./_shared/entitlements.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { getStripe } from "./_shared/stripe.mjs";
import {
  bearerFromEvent,
  getUserFromJwt,
  supabaseServiceConfig,
} from "./_shared/supabase.mjs";

async function fetchProfile(userId) {
  const { url, key } = supabaseServiceConfig();
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,plan,subscription_status,grace_until,stripe_subscription_id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function handler(event) {
  const cors = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return jsonError(405, "Method not allowed", null, cors);
  }
  if (!isOriginAllowed(event)) {
    return jsonError(403, "Origin not allowed", null, cors);
  }

  const token = bearerFromEvent(event);
  if (!token) return jsonError(401, "Sign in required.", null, cors);
  const user = await getUserFromJwt(token);
  if (!user?.id) return jsonError(401, "Session expired — sign in again.", null, cors);

  const rl = await rateLimit(event, {
    bucket: "stripe-session",
    limit: 30,
    windowSec: 60,
    userId: user.id,
    requireShared: true,
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  const sessionId = String(event.queryStringParameters?.session_id || "").trim();
  const stripe = getStripe();

  try {
    let profile = await fetchProfile(user.id);
    let reconciled = false;

    if (
      sessionId &&
      stripe &&
      profile &&
      !hasProAccess(profile) &&
      sessionId.startsWith("cs_")
    ) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const paid =
        session.payment_status === "paid" || session.payment_status === "no_payment_required";
      if (
        paid &&
        (session.metadata?.userId === user.id || session.client_reference_id === user.id)
      ) {
        await applyStripeEvent({
          id: `reconcile_${session.id}`,
          type: "checkout.session.completed",
          data: { object: session },
        });
        reconciled = true;
        profile = await fetchProfile(user.id);
      }
    }

    return jsonResponse(
      200,
      {
        plan: profile?.plan || "free",
        subscriptionStatus: profile?.subscription_status || null,
        pro: hasProAccess(profile),
        reconciled,
      },
      cors
    );
  } catch (err) {
    return jsonError(502, "Could not resolve billing session.", err, cors);
  }
}
