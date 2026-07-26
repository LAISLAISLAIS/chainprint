/**
 * OAuth provider config (Client IDs are public — safe in frontend JS).
 *
 * Google: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
 * Apple:  Apple Developer → Identifiers → Services ID (+ paid Apple Developer Program)
 *
 * Authorized JavaScript origins must include your live Netlify URL and localhost for testing.
 * On localhost without IDs, social buttons use a demo session.
 */

export const authConfig = {
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
