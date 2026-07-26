# Chainprint auth (Supabase)

## 1. Create a project
https://supabase.com → New project

## 2. Run the migration
SQL Editor → paste and run `supabase/migrations/001_profiles.sql`

## 3. Wire the frontend
In `js/auth/config.js` set:
- `supabaseUrl` → Project URL
- `supabaseAnonKey` → `anon` `public` key

## 4. Email auth settings
Authentication → Providers → Email: enabled  
Optional: disable “Confirm email” while testing so signup logs in immediately.

## 5. Password policy (dashboard)
Authentication → Settings → match: min 8 chars, require letters/digits/symbols as available.

Until keys are set, accounts still work in **this browser only** (local store) with the same Username + password rules.
