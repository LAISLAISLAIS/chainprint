/**
 * Mirror of client hasActivePro rules (kept in sync with js/auth/quota.js).
 * Node can't import browser modules cleanly; duplicate the predicate for CI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function hasActivePro(account, { devUnlock = false } = {}) {
  if (!account) return false;
  if (devUnlock) return true;
  if (account.plan !== "pro") return false;
  const status = String(account.subscriptionStatus || "active").toLowerCase();
  if (status === "active" || status === "trialing") return true;
  if (status === "past_due") {
    if (account.graceUntil) return new Date(account.graceUntil).getTime() > Date.now();
    return true;
  }
  if (!account.subscriptionStatus || status === "none") return true;
  return false;
}

describe("client hasActivePro rules", () => {
  it("treats canceled pro as inactive", () => {
    assert.equal(
      hasActivePro({ plan: "pro", subscriptionStatus: "canceled" }),
      false
    );
  });
  it("treats refunded as inactive", () => {
    assert.equal(
      hasActivePro({ plan: "pro", subscriptionStatus: "refunded" }),
      false
    );
  });
  it("legacy pro without status stays active", () => {
    assert.equal(hasActivePro({ plan: "pro" }), true);
  });
});
