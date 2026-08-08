/**
 * Analysis quota + plan gates.
 * Server RPC consume_analysis() is authoritative when Supabase is configured.
 */

import { isSupabaseConfigured } from "./config.js";
import { consumeAnalysisRemote, getSession, updateAccount } from "./session.js";

/** @typedef {'standard' | 'deep'} AnalysisMode */

/**
 * Dev unlock — off by default. Set window.__CHAINPRINT_DEV_UNLOCK__ = true only locally.
 */
function resolveDevUnlock() {
  try {
    if (typeof window !== "undefined" && window.__CHAINPRINT_DEV_UNLOCK__ === true) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export const DEV_UNLOCK_PRO = resolveDevUnlock();

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    analysesIncluded: DEV_UNLOCK_PRO ? Infinity : 1,
    deepAnalysis: DEV_UNLOCK_PRO,
    stripePriceEnv: null,
    blurb: DEV_UNLOCK_PRO
      ? "Dev unlock · unlimited + Deep"
      : "One free analysis · upgrade for Deep / Pro",
  },
  pro: {
    id: "pro",
    label: "Pro",
    analysesIncluded: Infinity,
    deepAnalysis: true,
    stripePriceEnv: "STRIPE_PRICE_PRO",
    blurb: "Unlimited analyses + deep vocal, design, instrumental & master analysis",
  },
};

/** True when the account should receive Pro entitlements right now. */
export function hasActivePro(account = getSession()) {
  if (!account) return false;
  if (DEV_UNLOCK_PRO) return true;
  if (account.plan !== "pro") return false;

  // Align with netlify/functions/_shared/entitlements.mjs + consume_analysis()
  const raw = account.subscriptionStatus;
  const status = String(raw == null || raw === "" ? "none" : raw).toLowerCase();
  if (status === "active" || status === "trialing") return true;
  if (status === "none") return true; // legacy pre-Stripe Pro rows
  if (status === "past_due") {
    if (account.graceUntil) return new Date(account.graceUntil).getTime() > Date.now();
    return true;
  }
  return false;
}

export function getPlan(account = getSession()) {
  if (!account) return null;
  if (hasActivePro(account)) return PLANS.pro;
  return PLANS.free;
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
export async function consumeAnalysis() {
  const account = getSession();
  if (!account) return null;
  const plan = getPlan(account);
  if (plan.analysesIncluded === Infinity) return account;

  if (isSupabaseConfigured()) {
    return consumeAnalysisRemote();
  }

  return updateAccount({ analysesUsed: (account.analysesUsed || 0) + 1 });
}

/** @deprecated Client cannot set plan when Supabase billing trigger is applied. */
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
