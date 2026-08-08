/**
 * POST /api/email/welcome — send welcome email once (Bearer JWT).
 */

import { corsHeaders, isOriginAllowed } from "./_shared/cors.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { sendWelcomeEmail } from "./_shared/product-emails.mjs";
import { bearerFromEvent, getUserFromJwt } from "./_shared/supabase.mjs";

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

  const token = bearerFromEvent(event);
  if (!token) return jsonError(401, "Sign in required.", null, cors);
  const user = await getUserFromJwt(token);
  if (!user?.id) return jsonError(401, "Session expired — sign in again.", null, cors);

  const rl = await rateLimit(event, {
    bucket: "welcome-email",
    limit: 5,
    windowSec: 3600,
    userId: user.id,
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  try {
    const result = await sendWelcomeEmail(user.id);
    return jsonResponse(200, result, cors);
  } catch (err) {
    console.warn("[welcome-email]", err?.message || err);
    return jsonError(500, "Couldn’t send welcome email.", null, cors);
  }
}
