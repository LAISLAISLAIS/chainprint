/**
 * Analysis quota + plan gates.
 * Feature tiering is intentionally light — structure first, pricing later.
 */

import { getSession, updateAccount } from "./session.js";

/** @typedef {'standard' | 'deep'} AnalysisMode */

/**
 * Flip to true while developing / testing to unlock Deep + unlimited free analyses.
 * Keep false for a public launch with real quotas.
 */
export const DEV_UNLOCK_PRO = false;

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    analysesIncluded: DEV_UNLOCK_PRO ? Infinity : 1,
    deepAnalysis: DEV_UNLOCK_PRO,
    blurb: DEV_UNLOCK_PRO
      ? "Dev unlock · unlimited + Deep"
      : "One free analysis · upgrade for Deep / Pro",
  },
  pro: {
    id: "pro",
    label: "Pro",
    analysesIncluded: Infinity,
    deepAnalysis: true,
    blurb: "Unlimited analyses + deep vocal, design, instrumental & master analysis",
  },
};

export function getPlan(account = getSession()) {
  if (!account) return null;
  return PLANS[account.plan] || PLANS.free;
}

export function analysesRemaining(account = getSession()) {
  if (!account) return 0;
  const plan = getPlan(account);
  if (plan.analysesIncluded === Infinity) return Infinity;
  const included = account.analysesIncluded ?? plan.analysesIncluded;
  if (included == null || included === Infinity) return Infinity;
  return Math.max(0, included - (account.analysesUsed || 0));
}

export function canAnalyze(account = getSession()) {
  if (!account) return { ok: false, reason: "auth" };
  const left = analysesRemaining(account);
  if (left <= 0) return { ok: false, reason: "quota" };
  return { ok: true, reason: null, remaining: left };
}

/** @param {AnalysisMode} mode */
export function canUseMode(mode, account = getSession()) {
  if (!account) return { ok: false, reason: "auth" };
  if (mode === "deep") {
    const plan = getPlan(account);
    if (!plan.deepAnalysis) return { ok: false, reason: "deep_locked" };
  }
  return canAnalyze(account);
}

/** Call after a successful analysis completes. */
export function consumeAnalysis() {
  const account = getSession();
  if (!account) return null;
  const plan = getPlan(account);
  if (plan.analysesIncluded === Infinity) return account;
  return updateAccount({ analysesUsed: (account.analysesUsed || 0) + 1 });
}

/** Dev / admin helper until billing exists. */
export function setPlan(planId) {
  if (!PLANS[planId]) throw new Error(`Unknown plan: ${planId}`);
  const included = PLANS[planId].analysesIncluded === Infinity ? null : PLANS[planId].analysesIncluded;
  return updateAccount({ plan: planId, analysesIncluded: included });
}

export function authUrl(nextPath = "/analyze/") {
  const next = encodeURIComponent(nextPath);
  return `../auth/?next=${next}`;
}

export function signupUrl(nextPath = "/analyze/") {
  const next = encodeURIComponent(nextPath);
  return `../auth/?mode=signup&next=${next}`;
}
