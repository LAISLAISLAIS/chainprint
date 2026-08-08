# Chainprint auth (Supabase)

## Launch checklist

1. Create a Supabase project and run SQL migrations **in order** (`001` → `008`).
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Netlify (and `.env` for local).
3. Client publishable URL/anon key: `js/auth/config.js` or `window.__CHAINPRINT_CONFIG__` inject. Never put the service role in the browser.
4. Auth → Email enabled; match password policy (min 8, upper, number, symbol).
5. Auth → URL Configuration: add `https://chainprint.app/auth/` and `https://chainprint.app/auth/?mode=reset` to Redirect URLs (see Password reset below).
6. Confirm `DEV_UNLOCK_PRO` is not forced on (`js/auth/quota.js` defaults off).
7. Google / Apple: Client IDs + Supabase providers before enabling UI buttons.

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

## Password reset (forgot password)

The login page links to **Forgot password?** → Supabase emails a recovery link → `/auth/?mode=reset` → user sets a new password.

### Dashboard

1. **Authentication → URL Configuration**
   - Site URL: `https://chainprint.app`
   - Redirect URLs include:
     - `https://chainprint.app/auth/`
     - `https://chainprint.app/auth/?mode=reset`
     - Local: `http://localhost:8888/auth/` and `http://localhost:8888/auth/?mode=reset` (or your port)
2. **Authentication → Email Templates → Reset password**
   - Confirm the link uses `{{ .ConfirmationURL }}` (default is fine).
3. **Authentication → Providers → Email** enabled; SMTP optional (Supabase built-in email works for testing; custom SMTP for production deliverability).

### App behavior

- `requestPasswordReset` → `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
- Recovery session lands on `/auth/?mode=reset`; `completePasswordReset` → `updateUser({ password })`
- `/auth` is exempt from the private-beta site gate so hash tokens in the email link are not stripped

### Branded auth emails

HTML templates live in `supabase/email-templates/` (recovery, confirm, magic link, invite, email change, reauth, password changed).

**Blocked on free tier + default mailer.** Supabase returns:
`Email template modification is not available for free tier projects using the default email provider.`

To brand body + From address:

1. Create a [Resend](https://resend.com) account (or Postmark/SES), verify `chainprint.app` (or a subdomain like `mail.chainprint.app`).
2. Supabase → **Authentication → SMTP**:
   - Host `smtp.resend.com`, port `465`, user `resend`, pass = Resend API key
   - Sender name `Chainprint`, sender email e.g. `noreply@mail.chainprint.app`
3. Push templates:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/push-email-templates.py
```

Until SMTP (or a paid Supabase plan) is configured, reset emails stay “Supabase Auth” with the default body/footer.

**Current prod:** Resend SMTP is configured (`smtp.resend.com`, sender **Chainprint** `<noreply@mail.chainprint.app>`). Branded templates are pushed.

## Notes

- Local demo password hashes are browser-only; production must use Supabase Auth (including email resets).
- Billing details: `docs/BILLING.md`.
