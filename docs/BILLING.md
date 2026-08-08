# Billing (Stripe)

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/stripe/checkout` | Bearer JWT | Create Checkout Session → `{ url }` |
| POST | `/api/stripe/webhook` | Stripe signature | Apply subscription events |
| POST | `/api/stripe/portal` | Bearer JWT | Customer Portal URL |
| GET | `/api/stripe/session?session_id=` | Bearer JWT | Poll + reconcile after success |

## Env

- `STRIPE_SECRET_KEY` — `sk_test_…` / `sk_live_…`
- `STRIPE_WEBHOOK_SECRET` — `whsec_…`
- `STRIPE_PRICE_PRO` — Price ID for Pro subscription
- `SUPABASE_SERVICE_ROLE_KEY` — webhook writes only
- `SITE_URL` — success/cancel/portal return URLs
- `SUBSCRIPTION_GRACE_DAYS` — default 7 for `past_due`

## Webhook events

Configure the endpoint `https://<prod>/api/stripe/webhook` for:

- `checkout.session.completed`
- `customer.subscription.created` / `updated` / `deleted`
- `invoice.paid` / `invoice.payment_failed`
- `charge.refunded`

## Local

```bash
stripe listen --forward-to localhost:8888/api/stripe/webhook
```

## Client

`js/billing/client.js` — `startCheckout`, `openBillingPortal`, `fetchBillingSession`.  
Settings page wires Upgrade / Manage billing; analyze quota gate upgrades via Checkout.
