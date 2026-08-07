/**
 * Mirror of client hasActivePro rules (kept in sync with js/auth/quota.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function hasActivePro(account, { devUnlock = false } = {}) {
  if (!account) return false;
  if (devUnlock) return true;
  if (account.plan !== "pro") return false;
  const raw = account.subscriptionStatus;
  const status = String(raw == null || raw === "" ? "none" : raw).toLowerCase();
  if (status === "active" || status === "trialing") return true;
  if (status === "none") return true;
  if (status === "past_due") {
    if (account.graceUntil) return new Date(account.graceUntil).getTime() > Date.now();
    return true;
  }
  return false;
}

describe("client hasActivePro rules", () => {
  it("treats canceled pro as inactive", () => {
    assert.equal(hasActivePro({ plan: "pro", subscriptionStatus: "canceled" }), false);
  });
  it("treats refunded as inactive", () => {
    assert.equal(hasActivePro({ plan: "pro", subscriptionStatus: "refunded" }), false);
  });
  it("legacy pro without status stays active", () => {
    assert.equal(hasActivePro({ plan: "pro" }), true);
  });
  it("legacy none status stays active", () => {
    assert.equal(hasActivePro({ plan: "pro", subscriptionStatus: "none" }), true);
  });
});
