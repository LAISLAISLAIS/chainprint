import { graceDays } from "./plans.mjs";

/**
 * Server-side Pro check — keep aligned with js/auth/quota.js hasActivePro().
 * @param {{ plan?: string, subscription_status?: string|null, grace_until?: string|null }} profile
 */
export function hasProAccess(profile) {
  if (!profile) return false;
  if (profile.plan !== "pro") return false;

  const raw = profile.subscription_status;
  const status = String(raw == null || raw === "" ? "none" : raw).toLowerCase();

  if (status === "active" || status === "trialing") return true;
  // Legacy rows before Stripe (plan=pro, status default none)
  if (status === "none") return true;
  if (status === "past_due") {
    if (profile.grace_until) {
      return new Date(profile.grace_until).getTime() > Date.now();
    }
    return true;
  }
  return false;
}

export function pastDueGraceUntil(from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + graceDays());
  return d.toISOString();
}
