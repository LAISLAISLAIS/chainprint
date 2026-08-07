import { graceDays } from "./plans.mjs";

/**
 * @param {{ plan?: string, subscription_status?: string, grace_until?: string|null }} profile
 */
export function hasProAccess(profile) {
  if (!profile) return false;
  if (profile.plan !== "pro") return false;
  const status = String(profile.subscription_status || "active").toLowerCase();
  if (status === "active" || status === "trialing") return true;
  if (status === "past_due") {
    if (profile.grace_until) {
      return new Date(profile.grace_until).getTime() > Date.now();
    }
    return true; // grace_until not set yet — treat briefly as allowed
  }
  return false;
}

export function pastDueGraceUntil(from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + graceDays());
  return d.toISOString();
}
