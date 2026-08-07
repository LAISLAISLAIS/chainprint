/** Server-side plan registry (keep in sync with js/auth/quota.js). */

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    analysesIncluded: 1,
    deepAnalysis: false,
    stripePriceEnv: null,
  },
  pro: {
    id: "pro",
    label: "Pro",
    analysesIncluded: null, // unlimited
    deepAnalysis: true,
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
};

export function priceIdForPlan(planId) {
  const plan = PLANS[planId];
  if (!plan?.stripePriceEnv) return null;
  return String(process.env[plan.stripePriceEnv] || "").trim() || null;
}

export function graceDays() {
  const n = Number(process.env.SUBSCRIPTION_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.min(30, Math.floor(n)) : 7;
}
