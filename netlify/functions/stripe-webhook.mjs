import { applyStripeEvent } from "./_shared/apply-stripe-event.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { getStripe } from "./_shared/stripe.mjs";

function rawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || "", "base64").toString("utf8");
  }
  return event.body || "";
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  const stripe = getStripe();
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !secret) {
    return jsonError(503, "Webhook is not configured.");
  }

  const signature =
    event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"] || "";
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody(event), signature, secret);
  } catch (err) {
    return jsonError(400, "Invalid webhook signature.", err);
  }

  try {
    const result = await applyStripeEvent(stripeEvent);
    return jsonResponse(200, { received: true, ...result });
  } catch (err) {
    // 500 so Stripe retries
    return jsonError(500, "Webhook processing failed.", err);
  }
}
