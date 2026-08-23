# Chainprint system review

Reviewed against `main` at `22ba888` (2026-08-23). Hypotheses from a prior launch scan were re-checked in the tree; this document is the source of truth for what is actually true today.

**Out of scope (do not treat as work in this PR):** paying or “fixing” Netlify usage, enabling live Stripe, implementing a full `analyze-page.js` split.

**Known ops debt (not a backlog item):** production `https://chainprint.app` currently returns Netlify `usage_exceeded` (HTTP 503) on `/` and `/api/health`. Billing restore on Netlify is parked. Hosting comes back when Owais chooses to pay; nothing below depends on that.

---

## Architecture snapshot

Chainprint is a **static multi-page app** (vanilla ES modules, no bundler) plus **Netlify Functions**, **Supabase** (Auth + Postgres + RLS), and **Stripe** subscriptions. The product — decode, measure, characterize, recommend a DAW chain — runs **in the browser**. The server is identity, quota, money, share links, and CORS proxies.

```
Browser (pages)
  /analyze  → analyze-page.js  → analyze.js
                               → dsp/{fft,metrics,pitch,tempo,instruments}
                               → recommend.js → chain.js / mix-chains.js
                               → quota.js → consume_analysis RPC
                               → lazy: share/chain-share.js, export/ableton-rack.js
  /auth     → auth-page.js     → session.js (Supabase Auth)
  /settings → settings-page.js → billing/client.js
  /c/:id    → share-page fn    → public shared_chains row + OG

Netlify
  functions/          thin handlers
  functions/_shared/  CORS, rate-limit, Stripe apply, entitlements, Supabase
  edge-functions/     HMAC site-gate (fail-open if password missing)

Supabase
  001–005  profiles, signup trigger, settings/avatars, shared_chains
  006–008  Stripe columns, consume_analysis(), billing-column trigger
  009      username/email login citext compare
  010      welcome_email_sent_at / pro_email_sent_at
```

| Layer        | Canonical path                                                      |
| ------------ | ------------------------------------------------------------------- |
| Studio       | `analyze/index.html` → `js/ui/analyze-page.js` (3281 lines)         |
| DSP + chain  | `js/analyze.js` → `js/dsp/*` → `js/recommend.js`                    |
| Auth / quota | `js/auth/{session,quota,config}.js` + `consume_analysis()`          |
| Billing      | `netlify/functions/stripe-*.mjs` + `_shared/apply-stripe-event.mjs` |
| Shares / MCP | `/api/shares`, `/api/chain/:id`, `mcp/` (Python)                    |
| Export       | `js/export/ableton-rack.js` → `.adg` (gzip XML)                     |
| Health / CI  | `GET /api/health`, `npm run check`, `.github/workflows/ci.yml`      |

**Production host is Netlify.** `vercel.json` (Odesli rewrite only) and `Dockerfile` + `deploy/nginx.conf` (static nginx, no functions) cannot bill, share, or gate. Treat them as leftover / local static hosts, not deploy targets.

---

## What’s already solid

The production path is largely **implemented**, not stubbed. The launch gap is ops + checklist, not missing product code.

- **Client-side DSP is honest and private.** Audio is decoded on-device (`js/analyze.js`). Measurement labels say “estimate / not the true chain.” Long masters are capped (`MAX_SPECTRUM_SEC` / `MAX_SPECTRUM_FRAMES` in `js/dsp/metrics.js`).
- **Billing is server-authoritative.** Checkout `mode: subscription`, signed webhook, Customer Portal, success-path reconcile (`stripe-session.mjs`). `protect_profile_billing_columns` blocks client writes to plan/quota/Stripe fields. `consume_analysis()` is the only client-callable decrement.
- **Webhook retry posture is correct.** Events are applied first, then recorded in `stripe_events` (`docs/SECURITY.md`). Failed apply does not poison the event id.
- **Entitlement rules exist in three places and are close.** `hasActivePro` (`js/auth/quota.js`), `hasProAccess` (`_shared/entitlements.mjs`), and `consume_analysis()` SQL all treat `active` / `trialing` / legacy `none` / `past_due`+grace the same way.
- **CORS + rate limits are real.** Write APIs use an origin allowlist. Production `requireShared: true` routes 503 without Upstash. Site gate has no hardcoded password; missing password **skips** the gate rather than 503ing the site.
- **Shares and Ableton export exist.** Authenticated CRUD, public `/c/:id` + `/api/chain/:id` for MCP, `.adg` assembly with a CI-gated smoke test (`npm run test:ableton`).
- **Transactional email path exists.** Resend welcome + Pro mail, tracked by migration `010`. Auth recovery is exempt from the site gate so hash tokens survive.
- **Release preflight and unit tests exist.** `npm run check` + `npm run test:billing` + `npm run test:ableton` run in CI, plus a blocking MCP `pytest` job. Function syntax is `node --check`’d.

`docs/LAUNCH_CHECKLIST.md` is still **fully unchecked**. That is the stated go-live gate (`AGENTS.md`: do not enable live Stripe until it is complete). Code being ready does not mean production is ready.

---

## Gaps / risks

Severity: **P0** = do before public/paid traffic when hosting returns. **P1** = soon after, or now if it does not need Netlify. **P2** = quality / DX.

| ID  | Severity | Area              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | P0       | Docs / DB         | Launch docs and `release-check` still talk as if migrations end at `008`. `009_fix_username_login.sql` and `010_transactional_emails.sql` are real. Without 009, username login can miss citext rows. Without 010, welcome/Pro mail cannot persist “already sent.” **This PR fixes the doc/check range;** applying SQL on the project is still an operator step.                                                                                           |
| G2  | P0       | Launch ops        | Checklist unchecked: Auth URLs, Upstash, CORS=prod, site-gate password or `SITE_GATE_ENABLED=0`, `/api/health` → `stripe: ok` + `rateLimitBackend: upstash`, billing smokes, legal copy. Site is down (`usage_exceeded`) so several items cannot be re-proved against prod until hosting returns.                                                                                                                                                          |
| G3  | P0       | Billing / product | Quota is consumed **after** a successful client analysis (`analyze-page.js` → `consumeAnalysis()`). DSP never leaves the browser, so the RPC is honor-system. A client that skips the call, or a throw after results are written to the library, yields a free analysis. Deep mode is a **client-only** gate (`canUseMode("deep")`).                                                                                                                       |
| G4  | P0       | Hosting confusion | `vercel.json` and Docker/nginx look like deploy configs but omit Stripe, shares, CSP/HSTS, and (Docker) every function. Shipping either as “prod” would serve a site that cannot bill or share. `.dockerignore` does not exclude `.env`.                                                                                                                                                                                                                   |
| G5  | P1       | CI                | Ableton rack + MCP pytest are now hard-fail in `.github/workflows/ci.yml` (`npm run test:ableton`, dedicated `mcp` job). Remaining: no `node:test` for DSP / recommend / a shared entitlement fixture. `quota-client.test.mjs` **reimplements** `hasActivePro` instead of importing it.                                                                                                                                                                 |
| G6  | P1       | Maintainability   | `js/ui/analyze-page.js` is 3281 lines (persist, quota chrome, library/blend, match, readout render, share/MCP, playback/dry stems, `runAnalysis`). `js/auth/session.js` is 1022 lines and still carries a localStorage demo-auth path that is dead while `js/auth/config.js` hardcodes a publishable project.                                                                                                                                              |
| G7  | P1       | Billing edges     | `past_due` with **null** `grace_until` is treated as Pro (fail-open) on client, server, and SQL. `invoice.paid` grants Pro without checking price/product. `008` trigger does **not** lock `welcome_email_sent_at` / `pro_email_sent_at` (added in `010`) — a client could mark mail sent. `CHAINPRINT_DEV_UNLOCK` is documented as an env flag “forced off in production”; **no code reads that env** — only `window.__CHAINPRINT_DEV_UNLOCK__ === true`. |
| G8  | P1       | Abuse / size      | `POST /api/shares` does not cap `payload` size. `/api/chain` and the SoundCloud/Odesli proxies are public CORS (`allowPublic`) with `requireShared: false`. `api/soundcloud.js` is a Vercel-shaped duplicate of `netlify/functions/soundcloud.mjs`.                                                                                                                                                                                                        |
| G9  | P2       | DX / drift        | `release-check.mjs` is string-presence preflight, not a live env or SQL verifier. Site gate exempts `/js/`, `/css/`, `/assets/` (source readable while gated). `resolve_login_email` is `security definer` + `anon` (username → email). `session.js` login upsert includes `plan: 'free'` when a profile fetch misses (trigger blocks a Pro overwrite; still a noisy path).                                                                                |

---

## Prioritized backlog

Each item is **why + approach**, not a line-by-line patch. Tiny doc-range fixes that were clearly wrong are in this same PR.

### P0 — pre-go-live when hosting returns

Do the ones that do **not** need a live Netlify site **now**. Save the ones that need a 200 from `chainprint.app` until the account is restored.

#### P0-1. Apply migrations 009–010 on the production Supabase project

**Why:** `009` fixes username login (`resolve_login_email` / `username_taken` must compare with `::citext`). `010` adds the columns welcome/Pro mail write. Docs in this PR now say `001`–`010`; the project still has to actually have them.

**Approach:** In the production SQL editor, run `009_fix_username_login.sql` then `010_transactional_emails.sql` (or paste `scripts/apply-all-migrations.sql` if the project is new). Verify:

```sql
select proname from pg_proc where proname in ('resolve_login_email', 'consume_analysis');
select column_name from information_schema.columns
  where table_name = 'profiles'
    and column_name in ('welcome_email_sent_at', 'pro_email_sent_at', 'stripe_customer_id');
```

Confirm a username login that used to fail (mixed-case stored name) resolves. No Netlify payment required.

#### P0-2. Walk the Supabase + Stripe **dashboard** half of `LAUNCH_CHECKLIST.md`

**Why:** Auth Site URL / redirect URLs, RLS self-upgrade failure, `consume_analysis` quota block, service role only in server env, Stripe test Product/Price/Portal/webhook event list — all of this is console work. None of it needs the public site to be up.

**Approach:** Use the existing checklist. Stay on **test** Stripe keys. Do not flip `sk_live_` / live Price IDs. Local `netlify dev` + `stripe listen` is enough to smoke checkout/webhook if you want a loop without production hosting.

#### P0-3. Decide the public-launch gate and health contract (apply when Netlify is back)

**Why:** Gate fail-open (missing `SITE_PASSWORD` skips the gate) is intentional so a bad merge does not brick the site — it is also how a “private beta” accidentally becomes public. `/api/health` 200 in production requires Upstash + full Stripe config.

**Approach:** Either set `SITE_PASSWORD` + `SITE_GATE_SIGNING_SECRET`, or set `SITE_GATE_ENABLED=0` for public launch. When hosting returns: CORS=`https://chainprint.app`, Upstash set, `CHAINPRINT_DEV_UNLOCK` unset, confirm `/api/health` → `"stripe":"ok"` and `"rateLimitBackend":"upstash"`. **Do not** “upgrade the Netlify plan” as a tracked engineering task; that is Owais’s billing decision.

#### P0-4. Treat client-side quota as a known product limit; tighten the consume path

**Why:** Analysis is local, so a determined client can skip `consume_analysis`. That is acceptable for a free-tier teaser **if** you know it. Today a successful run writes the library **then** awaits consume; a failed RPC still leaves the chain on screen.

**Approach (small, no server DSP):** Consume (or pre-flight RPC) **before** committing the library entry, and on `quota_exceeded` discard the result. Keep reruns (`shouldConsumeQuota = false`) free. Document in `docs/BILLING.md` that Deep/unlimited is client-enforced and Pro is the server plan flag. A later P1 can add a cheap “ticket” RPC that returns a nonce before analyze if you want a harder gate without uploading audio.

#### P0-5. Mark non-Netlify hosts as non-production (and never point DNS at them)

**Why:** A Vercel/Coolify deploy would look like the product and silently drop Checkout, webhooks, shares, and health.

**Approach:** Keep `vercel.json` / Docker for local static preview only. Add a one-line warning in README (this PR). Optionally add a huge comment at the top of `vercel.json` / `Dockerfile` in a later code PR, or delete them if unused. Exclude `.env` in `.dockerignore` before anyone builds an image.

---

### P1 — soon (mostly no Netlify required)

#### P1-1. Put Ableton + MCP + entitlement parity under CI

**Why:** Users pay for chains and Ableton export. CI used to protect only Stripe apply helpers and a string preflight. Ableton + MCP unit tests now hard-fail; entitlement/DSP coverage is still missing.

**Done:** `npm test` / `test:ableton` run `js/export/ableton-rack.test.mjs`. The `mcp` CI job installs `.[dev]` with `actions/setup-python` and runs `python -m pytest -q` (no `continue-on-error`).

**Still open:**

1. Import `hasProAccess` from `_shared/entitlements.mjs` and an extracted `hasActivePro` (or a tiny shared fixture) so `quota-client.test.mjs` cannot drift.
2. Optional cheap DSP test: one frozen `measureBuffer` / `characterize` fixture (synthetic buffer) so recommend output cannot silently flip.

#### P1-2. Split `analyze-page.js` without changing behavior

**Why:** Almost every studio change lands in one 3k-line module. Review, revert, and “did I break playback?” risk are high. Full rewrite is out of scope for this PR.

**Suggested extract order** (keep `analyze-page.js` as wiring + DOM bind):

| Module                 | Approx. current region                     | Responsibility                                        |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `analyze-workspace.js` | persist/restore ~51–147                    | IndexedDB/local workspace + guest adopt               |
| `analyze-access.js`    | ~348–437                                   | Quota chrome, Deep lock, Checkout CTA                 |
| `analyze-library.js`   | ~1054–1396                                 | Library rail, blend, entry → studio                   |
| `analyze-readout.js`   | ~1553–2083                                 | Bands / design / master / instruments / summary       |
| `analyze-playback.js`  | ~726–925                                   | Dry stems, hear strip, chain FX preview               |
| `analyze-share.js`     | ~2189–2260                                 | Share link + MCP dialog (already lazy-imports export) |
| stay in page           | `runAnalysis`, source ingest, view stepper | Orchestration only                                    |

Do one extract per PR. No new bundler. Add a smoke that `analyze/index.html` still loads the page module.

#### P1-3. Billing edge-case cleanup

**Why:** Fail-open `past_due` without grace, product-agnostic `invoice.paid`, and unlocked email-sent columns are how “I refunded / I never paid” still looks like Pro, or how welcome mail is suppressed.

**Approach:** Align the three entitlement implementations: `past_due` **requires** `grace_until > now()` (deny if null). Ignore `invoice.paid` unless the invoice’s subscription/price is `STRIPE_PRICE_PRO` (or metadata `plan=pro`). Extend `protect_profile_billing_columns` with `welcome_email_sent_at` / `pro_email_sent_at` (new migration `011`, not a silent edit of `008`). Either wire `CHAINPRINT_DEV_UNLOCK` via a Netlify snippet that sets `window.__CHAINPRINT_DEV_UNLOCK__` **only** when `CONTEXT !== production`, or delete the env name from `.env.example` / launch checklist so nobody thinks it does something.

#### P1-4. Share payload cap + proxy hygiene

**Why:** Unbounded jsonb + public chain JSON is an easy storage/egress footgun. Duplicate `api/soundcloud.js` will rot vs the Netlify function.

**Approach:** Reject `POST /api/shares` over a hard byte limit (e.g. 64–128 KB). Keep `/api/chain` rate-limited; consider `requireShared: true` in production once Upstash is guaranteed. Delete or clearly label `api/soundcloud.js` as Vercel-only leftover.

#### P1-5. Shrink `session.js` / retire demo auth

**Why:** Hardcoded publishable keys mean `isSupabaseConfigured()` is always true in the shipped UI. Hundreds of lines of localStorage users + SHA-256 “hashes” are unused in production and confuse agents.

**Approach:** Gate demo auth behind an explicit empty `supabaseUrl`, or move it to `js/auth/demo-store.js` and stop importing it when configured. Do not remove the publishable key pattern (anon + RLS is intended); just stop pretending local demo is a second production path.

---

### P2 — nice

- **Extract a shared entitlement module** used by SQL comments, client, and functions (even if SQL stays duplicated — one JS source).
- **DSP documentation:** one page (`docs/DSP.md`) describing bands, vocal-region estimate, tempo/pitch confidence, honesty rule — useful for support and for not over-claiming in marketing.
- **Release-check upgrades:** assert migrations `001`–`010` filenames exist (001–010 range is in this PR); later, optional live `/api/health` only when `SITE_URL` is up.
- **Site-gate exempt list:** `/js` being public is fine for a JS app; just do not treat the gate as hiding source.
- **Legal:** terms/privacy vs live billing once Stripe is live (checklist already has this).
- **Username → email RPC:** rate-limit or accept username-enumeration as inherent to “login with username.”
- **OG / share expiry cleanup:** periodic job for expired `shared_chains` (RLS already hides them from public read).

---

## Analyze-page split (detail)

`analyze-page.js` is the studio controller. It is large because it owns **state + DOM + side effects** for every studio surface:

1. Workspace persist/restore and guest → account adopt
2. Access gates and quota chrome (also Settings)
3. Source ingest (file / URL / identity confirm)
4. `runAnalysis` orchestration and library write
5. View stepper (chain / signature / compare / why / design / master)
6. Readout and plugin-face rendering
7. Blend + match-compare
8. Dry-stem / through-chain preview
9. Share + Ableton MCP dialog

The DSP pipeline itself is already split (`analyze.js`, `dsp/*`, `recommend.js`). Do not pull FFT/recommend into the page extract. Do not introduce a framework.

---

## CI as of this review

| Check                                 | Wired?                                               |
| ------------------------------------- | ---------------------------------------------------- |
| Function `node --check`               | Yes                                                  |
| `npm run check` (`release-check.mjs`) | Yes — now also requires `009` / `010` files to exist |
| `npm run test:billing`                | Yes — entitlements + `checkoutPaymentOk` only        |
| `js/export/ableton-rack.test.mjs`     | Yes — `npm run test:ableton` / `npm test`            |
| DSP / recommend / analyze             | **No**                                               |
| MCP `pytest`                          | Yes, hard-fail (`mcp` job, `setup-python` 3.12)      |
| MCP publish workflow pytest           | Yes, hard-fail (release only)                        |

---

## Related docs

| Doc                                          | Role                                  |
| -------------------------------------------- | ------------------------------------- |
| [AGENT_SCOUT.md](./AGENT_SCOUT.md)           | Short orientation; points here        |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Go-live gate (still unchecked)        |
| [BILLING.md](./BILLING.md)                   | Stripe routes and webhook events      |
| [SECURITY.md](./SECURITY.md)                 | Secrets, CORS, RLS, gate              |
| [AUTH_SETUP.md](./AUTH_SETUP.md)             | Supabase auth, migrations `001`–`010` |
| [../AGENTS.md](../AGENTS.md)                 | Contributor conventions               |
