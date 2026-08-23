# Agent scout

Light orientation for new agents. For architecture, verified gaps, and the prioritized backlog, read **[SYSTEM_REVIEW.md](./SYSTEM_REVIEW.md)** first.

The repo is a working vocal/mix-analysis SaaS (vanilla JS + Netlify Functions + Supabase + Stripe), not an empty starter. `docs/LAUNCH_CHECKLIST.md` is still fully unchecked. Production hosting is currently Netlify `usage_exceeded` — known ops debt; do not treat “upgrade Netlify” as engineering work.

## Read next

| Doc                                          | Why                                                     |
| -------------------------------------------- | ------------------------------------------------------- |
| [SYSTEM_REVIEW.md](./SYSTEM_REVIEW.md)       | Architecture snapshot, what’s solid, P0–P2 backlog      |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Go-live gate (do not enable live Stripe until complete) |
| [AUTH_SETUP.md](./AUTH_SETUP.md)             | Supabase auth + migrations `001`–`010`                  |
| [BILLING.md](./BILLING.md)                   | Checkout / webhook / portal                             |
| [SECURITY.md](./SECURITY.md)                 | Secrets, CORS, RLS, site gate                           |
| [../AGENTS.md](../AGENTS.md)                 | Commands and conventions                                |

## Stack in one screen

- **Client:** multi-page static HTML + ES modules. Studio is `js/ui/analyze-page.js` (~3.3k lines). DSP is in-browser (`js/analyze.js` → `js/dsp/*` → `js/recommend.js`).
- **Host:** Netlify is production. `vercel.json` and Docker/nginx are non-prod static leftovers.
- **API:** thin `netlify/functions/*.mjs`; logic in `_shared/`.
- **Data:** Supabase migrations `001`–`010`. Plan/quota are not client-writable.
- **CI:** `npm run check` + `test:billing` + `test:ableton` (hard-fail). MCP `pytest` is a separate hard-fail job. Entitlement-fixture drift and DSP/recommend tests are still open (SYSTEM_REVIEW P1-1 remainder).

## If you only open three files

1. `docs/SYSTEM_REVIEW.md`
2. `docs/LAUNCH_CHECKLIST.md`
3. `js/analyze.js` + `netlify/functions/_shared/apply-stripe-event.mjs`
