/**
 * OAuth provider config.
 * Paste Client IDs from Google Cloud / Apple Developer to enable real sign-in.
 * On localhost without IDs, social buttons use a local demo session so you can test the flow.
 */

export const authConfig = {
  /** Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (Web) */
  googleClientId: "",

  /**
   * Apple Developer → Identifiers → Services ID
   * Requires HTTPS + registered return URL in production.
   */
  appleClientId: "",

  /** Must match an Apple Return URL (https). Used when appleClientId is set. */
  appleRedirectURI: typeof location !== "undefined" ? `${location.origin}/auth/` : "",
};
