import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasProAccess } from "./entitlements.mjs";
import { __testing } from "./apply-stripe-event.mjs";

describe("hasProAccess", () => {
  it("allows active pro", () => {
    assert.equal(hasProAccess({ plan: "pro", subscription_status: "active" }), true);
  });
  it("allows trialing", () => {
    assert.equal(hasProAccess({ plan: "pro", subscription_status: "trialing" }), true);
  });
  it("allows legacy none status", () => {
    assert.equal(hasProAccess({ plan: "pro", subscription_status: "none" }), true);
  });
  it("allows missing status as legacy none", () => {
    assert.equal(hasProAccess({ plan: "pro" }), true);
  });
  it("denies free", () => {
    assert.equal(hasProAccess({ plan: "free", subscription_status: "none" }), false);
  });
  it("allows past_due within grace", () => {
    const grace = new Date(Date.now() + 86400000).toISOString();
    assert.equal(
      hasProAccess({ plan: "pro", subscription_status: "past_due", grace_until: grace }),
      true
    );
  });
  it("denies past_due after grace", () => {
    const grace = new Date(Date.now() - 86400000).toISOString();
    assert.equal(
      hasProAccess({ plan: "pro", subscription_status: "past_due", grace_until: grace }),
      false
    );
  });
  it("denies canceled", () => {
    assert.equal(hasProAccess({ plan: "pro", subscription_status: "canceled" }), false);
  });
});

describe("checkoutPaymentOk", () => {
  it("accepts paid", () => {
    assert.equal(__testing.checkoutPaymentOk({ payment_status: "paid" }), true);
  });
  it("accepts no_payment_required", () => {
    assert.equal(__testing.checkoutPaymentOk({ payment_status: "no_payment_required" }), true);
  });
  it("rejects unpaid", () => {
    assert.equal(__testing.checkoutPaymentOk({ payment_status: "unpaid" }), false);
  });
});
