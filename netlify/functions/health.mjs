import { rateLimitBackendStatus } from "./_shared/rate-limit.mjs";
import { checkoutConfigured, stripePublishableReady } from "./_shared/stripe.mjs";
import { jsonResponse } from "./_shared/errors.mjs";

async function pingSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return "missing";
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
    });
    // Some projects lack /auth/v1/health — treat any network response as ok-ish
    if (res.ok || res.status === 404) return "ok";
    return "bad";
  } catch {
    return "bad";
  }
}

export async function handler() {
  const supabase = await pingSupabase();
  const rateLimitBackend = rateLimitBackendStatus();
  const stripe = stripePublishableReady()
    ? checkoutConfigured()
      ? "ok"
      : "partial"
    : "not_configured";

  const production = process.env.CONTEXT === "production";
  const ok =
    supabase === "ok" &&
    (!production || rateLimitBackend === "upstash") &&
    (!production || stripe === "ok" || stripe === "partial");

  return jsonResponse(ok ? 200 : 503, {
    ok,
    supabase,
    stripe,
    rateLimitBackend,
    context: process.env.CONTEXT || "local",
  });
}
