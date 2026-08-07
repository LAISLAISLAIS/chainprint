# Chainprint auth (Supabase)

## Launch checklist

1. Create a Supabase project and run SQL migrations **in order** (`001` → `008`).
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Netlify (and `.env` for local).
3. Client publishable URL/anon key: `js/auth/config.js` or `window.__CHAINPRINT_CONFIG__` inject. Never put the service role in the browser.
4. Auth → Email enabled; match password policy (min 8, upper, number, symbol).
5. Confirm `DEV_UNLOCK_PRO` is not forced on (`js/auth/quota.js` defaults off).
6. Google / Apple: Client IDs + Supabase providers before enabling UI buttons.

### Migrations (billing-critical)

| File | Purpose |
|------|---------|
| `001`–`005` | Profiles, shares, settings, expiry |
| `006_billing.sql` | Stripe columns + `stripe_events` |
| `007_consume_analysis.sql` | Quota RPC |
| `008_profiles_rls_lockdown.sql` | Billing field trigger |

### “violates row-level security policy for table profiles”

Run `002_profile_on_signup.sql`. The trigger creates the profile as `security definer` when signup returns no session.

### Quota

Use `consume_analysis()` (called from `js/auth/quota.js`). Clients cannot bump `analyses_used` or set `plan` directly — see `docs/SECURITY.md`.

### Settings / avatars

`/settings/` — photos use the `avatars` Storage bucket when `003` is applied.

## Notes

- Local demo password hashes are browser-only; production must use Supabase Auth.
- Billing details: `docs/BILLING.md`.
