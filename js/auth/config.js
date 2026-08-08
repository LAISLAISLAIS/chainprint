/**
 * Auth + product config (public keys only — enforce access with Supabase RLS).
 *
 * Production: set the same values via Netlify env and optionally inject
 *   window.__CHAINPRINT_CONFIG__ = { supabaseUrl, supabaseAnonKey }
 * before this module loads. Anon/publishable keys are public by design;
 * never put SUPABASE_SERVICE_ROLE_KEY or STRIPE_SECRET_KEY here.
 *
 * Setup:
 * 1. Create a project at https://supabase.com
 * 2. Run supabase/migrations/*.sql in order
 * 3. Set SUPABASE_URL + SUPABASE_ANON_KEY in Netlify (and below for local static serving)
 * 4. Auth → Email enabled; match password rules in the dashboard
 */

const injected =
  (typeof globalThis !== "undefined" && globalThis.__CHAINPRINT_CONFIG__) || {};

export const authConfig = {
  /**
   * Supabase Project URL, e.g. "https://xxxx.supabase.co"
   * Leave empty to use local demo storage (same browser only).
   */
  supabaseUrl: injected.supabaseUrl || "https://wggvvgigtwzwivpgszyr.supabase.co",

  /** Supabase anon/public key (safe with RLS) */
  supabaseAnonKey:
    injected.supabaseAnonKey || "sb_publishable_mGJIAlOvSs_5sahA8i0qiQ_q5gskCtM",

  googleClientId: injected.googleClientId || "",

  appleClientId: injected.appleClientId || "",

  /** Must match an Apple Return URL exactly. */
  appleRedirectURI: typeof location !== "undefined" ? `${location.origin}/auth/` : "",
};

export function isSupabaseConfigured() {
  return Boolean(
    String(authConfig.supabaseUrl || "").trim() &&
      String(authConfig.supabaseAnonKey || "").trim()
  );
}
