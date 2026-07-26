# Chainprint auth (Supabase)

## Launch checklist
1. Set `DEV_UNLOCK_PRO = false` in `js/auth/quota.js` (already off for production builds).
2. Create a Supabase project and run `supabase/migrations/001_profiles.sql`.
3. Put Project URL + anon key in `js/auth/config.js` (or inject at deploy).
4. Auth → Email enabled; optionally disable “Confirm email” while testing.
5. Match password policy: min 8, upper, number, symbol.
6. Google / Apple: add Client IDs in `config.js` *and* enable providers in Supabase before showing those buttons.

Until keys are set, accounts stay in **this browser only**.

## Notes
- Quota updates from the client are a soft gate until you add a privileged `consume_analysis` RPC.
- Local password hashes are demo-only; use Supabase Auth in production.
