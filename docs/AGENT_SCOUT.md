# Agent scout

Light map of **Chainprint** as of this pass. No runtime or CI changes; this file is orientation only.

The repo is **not empty**. It is a working vocal/mix-analysis SaaS: static multi-page vanilla JS, Netlify Functions, Supabase, Stripe. Billing, auth, RLS, rate limits, and a launch checklist already exist. `docs/LAUNCH_CHECKLIST.md` is still fully unchecked.

## Stack

| Layer | Choice |
|-------|--------|
| Client | Multi-page static HTML + ES modules (no bundler, no framework) |
| Host | Netlify (`netlify.toml`, `_redirects`). `vercel.json` + `Dockerfile`/`deploy/nginx.conf` are leftover/alternate static hosts |
| API | Netlify Functions (`*.mjs`, esbuild bundle). Logic lives in `netlify/functions/_shared/` |
| Edge | `netlify/edge-functions/site-gate.js` — HMAC cookie gate; fail-open if password missing |
| Auth / DB | Supabase (email auth, RLS, RPCs). Migrations `001`–`010` |
| Billing | Stripe Checkout (`mode: subscription`) + signed webhook + Customer Portal + success reconcile |
| Rate limit | Upstash Redis REST (required in production; in-memory fallback for `netlify dev`) |
| Email | Resend (welcome / Pro). Auth mail still via Supabase SMTP/templates |
| DSP | In-browser: decode → `js/dsp/*` → `recommend.js` → chain. Audio does not upload |
| Ableton | `js/export/ableton-rack.js` + Python MCP package in `mcp/` |
| Node | `>=20`. Runtime deps: `stripe`, `@upstash/redis`. Dev: `netlify-cli`, `prettier` |

Canonical origin in markup: `https://chainprint.app`.

## Layout (what matters)

```
index.html, analyze/, auth/, settings/, find/, calibration/, tools/, help/, c/, …
js/                  client modules
  analyze.js         decode → measure → characterize → chain
  dsp/               fft, pitch, tempo, metrics, instruments
  recommend.js       characterization + plugin picks
  ui/*-page.js       page controllers (analyze-page.js is the studio)
  auth/, billing/, session/, export/, pro/
css/
netlify/functions/   shares, stripe-*, proxies, health, welcome-email, og, chain
netlify/functions/_shared/   cors, entitlements, stripe apply, rate-limit
netlify/edge-functions/      site-gate
supabase/migrations/ 001_profiles … 010_transactional_emails
mcp/                 chainprint-mcp (Ableton Live via MCP)
docs/                AUTH, BILLING, SECURITY, LAUNCH_CHECKLIST, BRAND_TYPE
```

## Entry points

### Pages (HTML → one page module)

| URL | File | Controller |
|-----|------|------------|
| `/` | `index.html` | landing + `js/ui/hero-motion.js` |
| `/analyze/` | `analyze/index.html` | **`js/ui/analyze-page.js`** (studio; ~3280 lines) |
| `/auth/` | `auth/index.html` | `js/ui/auth-page.js` |
| `/settings/` | `settings/index.html` | `js/ui/settings-page.js` |
| `/find/` | `find/index.html` | `js/ui/find-page.js` |
| `/calibration/` | `calibration/index.html` | `js/ui/calibration-page.js` |
| `/c/:id` | rewrite → `share-page` function | SSR share + OG |
| `/help/`, `/tools/`, `/privacy/`, `/terms/` | static | — |

Analysis pipeline (called from the studio): `analyzeFile` / `analyzeUrl` in `js/analyze.js` → `decodeFile` → `measureBufferAsync` (`js/dsp/metrics.js`) → `characterize` / `recommend` (`js/recommend.js`). Quota: `js/auth/quota.js` → RPC `consume_analysis` when Supabase is configured.

Auth config: `js/auth/config.js` (publishable URL/anon key; optional `window.__CHAINPRINT_CONFIG__`). Billing UI: `js/billing/client.js`.

### HTTP API (rewrites in `_redirects` + `netlify.toml`)

| Path | Function | Role |
|------|----------|------|
| `GET /api/health` | `health.mjs` | Supabase / Stripe / Upstash readiness (prod 503 if Stripe or Upstash incomplete) |
| `POST /api/stripe/checkout` | `stripe-checkout.mjs` | JWT → Checkout Session |
| `POST /api/stripe/webhook` | `stripe-webhook.mjs` | Signed events; sole Pro grantor |
| `POST /api/stripe/portal` | `stripe-portal.mjs` | Customer Portal |
| `GET /api/stripe/session` | `stripe-session.mjs` | Post-checkout reconcile |
| `/api/shares` | `shares.mjs` | Auth share CRUD |
| `/api/chain`, `/api/chain/:id` | `chain.mjs` | Public share JSON (MCP / clients) |
| `/api/odesli`, `/api/soundcloud` | proxies | CORS-blocked upstreams |
| `/api/og`, `/api/og/:id` | `og-chain.mjs` | Per-chain OG image |
| `/api/email/welcome` | `welcome-email.mjs` | Product welcome mail |

Client should stay thin; keep logic in `_shared/`.

### Local / CI

```bash
cp .env.example .env   # fill values
npm install
npm run dev            # netlify dev → :8888
npm run check          # scripts/release-check.mjs (static preflight)
npm run test:billing   # node --test netlify/functions/_shared/*.test.mjs
```

CI (`.github/workflows/ci.yml`): function `node --check`, `npm run check`, `test:billing`. MCP pytest is `continue-on-error: true`. `js/export/ableton-rack.test.mjs` exists but is **not** in any npm script or CI job.

## How the app is structured

1. **Browser does the product.** Upload/URL fetch stays on-device. DSP + recommend + chain build are client modules. Pro “deep” mode is an entitlement, not a server model.
2. **Server is identity, quota, money, shares, proxies.** JWT on Stripe/share routes. Service role only on webhook / plan writes. `protect_profile_billing_columns` + `consume_analysis()` keep plan/quota off the client write path.
3. **Pages are folders of `index.html`**, not a SPA router. Shared chrome via CSS (`chassis.css`, `auth.css`) and `js/ui/nav-auth.js`.
4. **Two entitlement implementations must stay aligned:** `js/auth/quota.js` `hasActivePro()` and `netlify/functions/_shared/entitlements.mjs` `hasProAccess()` (commented as such; no shared test).
5. **Docs already cover the production path** — read `AGENTS.md`, then AUTH / BILLING / SECURITY / LAUNCH_CHECKLIST before changing those systems.

## Top 3 highest-leverage improvements

Concrete, ordered by leverage. Do not start these in this PR.

### 1. Close the launch-gate ops loop (migrations 009–010 + checklist)

`docs/LAUNCH_CHECKLIST.md` is still all unchecked. That is the stated go-live gate (`AGENTS.md`: do not enable live Stripe until it is complete).

Docs and tooling **stop at 008**, but the tree has:

- `009_fix_username_login.sql` — `resolve_login_email` citext compare; without it, username login can fail
- `010_transactional_emails.sql` — `welcome_email_sent_at` / `pro_email_sent_at`; without it, welcome/Pro mail can resend or error

Still say `001`–`008` only: `README.md`, `docs/AUTH_SETUP.md`, `docs/LAUNCH_CHECKLIST.md`, `scripts/apply-migrations.md`, `scripts/release-check.mjs`.

**Do this:** extend those five files to `001`–`010`; apply 009–010 on the prod project if not already; then walk the existing checklist (Upstash, CORS=prod, `SITE_GATE_ENABLED=0` or a real password, `/api/health` → `stripe: ok` + `rateLimitBackend: upstash`, billing smokes). Highest leverage because public launch and paid conversion are blocked on ops, not missing product code.

### 2. Put the analysis core under CI (and stop ignoring MCP)

CI protects billing apply + a static release-check. The thing users pay for is barely tested:

- No `node --test` for `js/dsp/metrics.js`, `js/recommend.js`, `js/analyze.js`, or `js/auth/quota.js`
- `js/export/ableton-rack.test.mjs` is runnable (`node --test js/export/ableton-rack.test.mjs`) but unwired
- MCP pytest is `continue-on-error: true` (`.github/workflows/ci.yml`)
- `hasActivePro` vs `hasProAccess` can drift with no fixture

**Do this:** add `npm test` that runs existing `*.test.mjs` **plus** `js/export/ableton-rack.test.mjs`; add small `node:test` cases for quota/entitlement parity (active / past_due+grace / canceled) and one recommend/characterize fixture; fail CI on MCP pytest once it is green. This is the cheapest way to stop regressions in export, plan gates, and chain output.

### 3. Split `js/ui/analyze-page.js` and mark Netlify as the only production host

`analyze-page.js` is ~3280 lines: persist/library, quota/checkout, share/export (lazy), playback, blend, dry stems, UI. Almost every product change lands here; review and revert risk are high.

**Do this:** extract without behavior change — persist/workspace, quota/checkout gates, share/Ableton export, playback/playlist — and keep the page file as wiring. Same turn: either delete or clearly mark `vercel.json` (odesli-only rewrite, no Stripe/shares/CSP/HSTS) and the Docker/nginx static image (no functions) as **non-production**, so an agent or host does not ship a site that cannot bill or share.

## Notes for later (not top 3)

- `release-check.mjs` is string-presence preflight, not a live env or SQL verifier.
- Site gate fail-open: missing `SITE_PASSWORD` skips the gate rather than 503 (`docs/SECURITY.md`).
- `CHAINPRINT_DEV_UNLOCK` is forced off in Netlify production; do not hardcode `DEV_UNLOCK_PRO = true`.
- Publishable Supabase URL/anon key are inlined in `js/auth/config.js` (anon + RLS is the intended model; service role must stay server-only).
- `api/soundcloud.js` sits beside `netlify/functions/soundcloud.mjs` — confirm which host uses it before editing.
- Legal pages exist; launch checklist still wants them matched to live billing.

## If you only read three files

1. `AGENTS.md`
2. `docs/LAUNCH_CHECKLIST.md`
3. `js/analyze.js` + `netlify/functions/_shared/apply-stripe-event.mjs`
