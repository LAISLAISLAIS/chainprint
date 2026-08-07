# Production launch checklist

Do not enable live Stripe or open the site publicly until every box is checked.

## Supabase

- [ ] Migrations `001`–`008` applied on production project (see `scripts/apply-migrations.md`)
- [ ] REST self-upgrade of `plan` fails (trigger / RLS)
- [ ] `consume_analysis` works for free user and blocks at quota
- [ ] Service role key only in Netlify env (not client)
- [ ] Auth Site URL + redirect URLs point at production domain

## Netlify

- [ ] **Required before merge/deploy:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in production context (no publishable fallbacks in prod)
- [ ] Env set from `.env.example` (live Stripe, Upstash, CORS=prod origin, SITE_*)
- [ ] `CHAINPRINT_DEV_UNLOCK` unset / not `1`
- [ ] Gate: set `SITE_PASSWORD` + `SITE_GATE_SIGNING_SECRET`, or `SITE_GATE_ENABLED=0` (missing password skips gate — does not 503 the site)
- [ ] `/api/health` returns `"stripe":"ok"` and `"rateLimitBackend":"upstash"` in production
- [ ] Deploy previews use **test** Stripe keys only
- [ ] Custom domain HTTPS; headers present (`/api/health` 200)

## Stripe

- [ ] Live Product + Price; `STRIPE_PRICE_PRO` set
- [ ] Webhook endpoint with full event list (see `docs/BILLING.md`)
- [ ] Customer Portal enabled (cancel + payment method)
- [ ] Test-mode smoke on preview; live smoke by operator

## Abuse / security

- [ ] Upstash connected; proxy spam returns 429
- [ ] Foreign origin blocked on `/api/shares`
- [ ] Forged webhook → 400
- [ ] CSP does not break analyze / auth (manual)

## Billing smoke

- [ ] Free → Checkout → Pro (~30s)
- [ ] Portal cancel → downgrade
- [ ] Failed payment → past_due / grace
- [ ] Refund → access revoked
- [ ] Duplicate webhook → no double apply
- [ ] Already Pro → checkout 409

## Legal

- [ ] Terms / privacy match live billing
- [ ] Support path for billing issues documented
