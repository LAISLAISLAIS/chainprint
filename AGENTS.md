# Chainprint — Agent Context

Vocal analysis SaaS: static vanilla JS + Netlify Functions + Supabase + Stripe.

## Read first

| Document | Location |
|----------|----------|
| Launch gate | `docs/LAUNCH_CHECKLIST.md` |
| Billing | `docs/BILLING.md` |
| Security | `docs/SECURITY.md` |
| Auth / RLS | `docs/AUTH_SETUP.md` |
| Env template | `.env.example` |

## Implemented (production path)

- Stripe Checkout (`mode: subscription`) + signed webhook + Customer Portal + success reconcile
- Server-authoritative `consume_analysis` RPC; billing columns protected by trigger
- CORS allowlist, Upstash rate limits (required in production), security headers
- HMAC site-gate cookie (disable with `SITE_GATE_ENABLED=0` for public launch)
- `GET /api/health`, `npm run check`, CI workflow

## Commands

```bash
npm install
cp .env.example .env   # fill values
npm run dev            # netlify dev
npm run check
npm run test:billing
```

## Conventions

- **Chainprint** — product name
- Never commit `.env` or service-role / Stripe secret keys
- Do not enable **live** Stripe until `docs/LAUNCH_CHECKLIST.md` is complete
- Plan / quota / Stripe IDs are **not** client-writable
- Prefer thin Netlify handlers; logic in `netlify/functions/_shared/`
