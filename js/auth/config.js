/**
 * Auth + product config (public keys only — enforce access with Supabase RLS).
 *
 * Setup:
 * 1. Create a free project at https://supabase.com
 * 2. Run supabase/migrations/001_profiles.sql in the SQL editor
 * 3. Paste Project URL + anon key below (or set Netlify env and inject at build)
 * 4. Auth → Providers → Email enabled; set password requirements in dashboard to match
 */

export const authConfig = {
  /**
   * Supabase Project URL, e.g. "https://xxxx.supabase.co"
   * Leave empty to use local demo storage (same browser only).
   */
  supabaseUrl: "",

  /** Supabase anon/public key */
  supabaseAnonKey: "",

  /** e.g. "123456789-abcdefg.apps.googleusercontent.com" */
  googleClientId: "",

  /**
   * Services ID, e.g. "com.yourname.chainprint.web"
   * Requires HTTPS + Return URL = https://YOUR_SITE/auth/
   */
  appleClientId: "",

  /** Must match an Apple Return URL exactly. */
  appleRedirectURI: typeof location !== "undefined" ? `${location.origin}/auth/` : "",
};

export function isSupabaseConfigured() {
  return Boolean(
    String(authConfig.supabaseUrl || "").trim() &&
      String(authConfig.supabaseAnonKey || "").trim()
  );
}
