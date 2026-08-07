# Security

## Secrets

- **Server only:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_PASSWORD`, `SITE_GATE_SIGNING_SECRET`, Upstash tokens
- **Publishable:** `SUPABASE_ANON_KEY` (RLS required), client config in `js/auth/config.js`
- Functions must not hardcode project URLs/keys (see `_shared/supabase.mjs`)
- Site gate has **no default password**

## Headers (`netlify.toml`)

CSP, HSTS, `X-Frame-Options: DENY`, `Permissions-Policy` (microphone self for analyze), `X-XSS-Protection: 0`.

## CORS

`CORS_ORIGINS` allowlist for shares + Stripe APIs. Proxies may use public CORS but are rate limited.

## Rate limits

Upstash Redis REST in production (`requireShared: true` → 503 if missing). In-memory fallback for local `netlify dev` only.

## Entitlements

- Trigger `protect_profile_billing_columns` blocks client updates to plan/quota/stripe fields
- `consume_analysis()` is the only client-callable quota decrement (sets bypass flag)
- Stripe webhook (service role) is the sole Pro grantor (+ session reconcile)

## Site gate

HMAC-signed HttpOnly cookie. Exempt: `/api/chain/*`, `/api/stripe/webhook`, `/api/health`.  
If `SITE_GATE_ENABLED` is on but `SITE_PASSWORD` is missing, the gate is **skipped** (fail open) so a misconfigured deploy does not brick the site — set the password or `SITE_GATE_ENABLED=0`.  
Public launch: `SITE_GATE_ENABLED=0`.

## Stripe webhook idempotency

Events are applied first, then recorded in `stripe_events`. A failed apply does **not** poison the event id, so Stripe retries can still grant Pro.
