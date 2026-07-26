/**
 * Shared password + username rules for signup / validation UI.
 */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

/**
 * @param {string} password
 * @returns {{ ok: boolean, message?: string, checks: { length: boolean, upper: boolean, number: boolean, symbol: boolean } }}
 */
export function validatePassword(password) {
  const value = String(password || "");
  const checks = {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
  const ok = checks.length && checks.upper && checks.number && checks.symbol;
  let message;
  if (!ok) {
    if (!checks.length) message = "Password must be at least 8 characters.";
    else if (!checks.upper) message = "Password needs at least 1 uppercase letter.";
    else if (!checks.number) message = "Password needs at least 1 number.";
    else if (!checks.symbol) message = "Password needs at least 1 symbol (e.g. !@#$).";
  }
  return { ok, message, checks };
}

/**
 * @param {string} username
 * @returns {{ ok: boolean, message?: string, normalized: string }}
 */
export function validateUsername(username) {
  // Preserve user casing (LAIS stays LAIS). Uniqueness is checked case-insensitively elsewhere.
  const normalized = String(username || "").trim();
  if (!normalized) {
    return { ok: false, message: "Choose a username.", normalized: "" };
  }
  if (!USERNAME_RE.test(normalized)) {
    return {
      ok: false,
      message: "Username must be 3–24 characters: letters, numbers, or underscore.",
      normalized,
    };
  }
  return { ok: true, normalized };
}

export function looksLikeEmail(value) {
  return String(value || "").includes("@");
}
