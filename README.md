# Chainprint

Vocal signal readout — see how the record was made.

Static multi-page app (vanilla JS) + Netlify Functions + Supabase Auth/DB + Stripe subscriptions.

## Layout

```
chainprint/
├── index.html, analyze/, auth/, settings/, …   # pages
├── js/                  # client modules (auth, dsp, billing, ui)
├── css/
├── netlify/functions/   # API: shares, stripe, proxies, health
├── netlify/edge-functions/  # optional site password gate
├── supabase/migrations/ # apply in order on your project
├── mcp/                 # Ableton Live MCP package (Python)
├── docs/                # AUTH, BILLING, SECURITY, LAUNCH_CHECKLIST, AGENT_SCOUT
└── package.json         # stripe + upstash for functions
```

## Local run

```bash
cp .env.example .env
# fill SUPABASE_*, SITE_URL, CORS_ORIGINS, SITE_PASSWORD, …
npm install
npm run dev          # netlify dev → http://localhost:8888
```

Apply SQL in `supabase/migrations/` (001 → 008) on your Supabase project before testing auth/billing.

Stripe locally:

```bash
stripe listen --forward-to localhost:8888/api/stripe/webhook
# put the whsec_… into STRIPE_WEBHOOK_SECRET
```

## Production

1. Set Netlify env from `.env.example` (live Stripe + Upstash required).
2. Run migrations including `006`–`008`.
3. Follow [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).
4. `npm run check` before deploy.

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md) | Supabase auth + RLS |
| [docs/BILLING.md](docs/BILLING.md) | Stripe checkout / webhook / portal |
| [docs/SECURITY.md](docs/SECURITY.md) | Headers, CORS, rate limits, secrets |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | Go-live gate |
| [docs/AGENT_SCOUT.md](docs/AGENT_SCOUT.md) | Stack map, entry points, top follow-ups |
| [AGENTS.md](AGENTS.md) | Agent / contributor context |
