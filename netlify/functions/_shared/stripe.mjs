import Stripe from "stripe";

let stripeClient = null;

export function getStripe() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export function checkoutConfigured() {
  return Boolean(
    getStripe() &&
      String(process.env.STRIPE_PRICE_PRO || "").trim() &&
      String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()
  );
}

export function stripePublishableReady() {
  return Boolean(getStripe() && String(process.env.STRIPE_PRICE_PRO || "").trim());
}
