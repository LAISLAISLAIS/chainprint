# Apply Supabase migrations

In the Supabase SQL editor (production project), run each file **in order**:

1. `supabase/migrations/001_profiles.sql`
2. `supabase/migrations/002_profile_on_signup.sql`
3. `supabase/migrations/003_profile_settings.sql`
4. `supabase/migrations/004_shared_chains.sql`
5. `supabase/migrations/005_shared_chains_expiry.sql`
6. `supabase/migrations/006_billing.sql` ← Stripe columns + `stripe_events`
7. `supabase/migrations/007_consume_analysis.sql` ← quota RPC
8. `supabase/migrations/008_profiles_rls_lockdown.sql` ← billing field trigger

Verify:

```sql
-- Should error for a normal user JWT (billing_fields_readonly)
-- update profiles set plan = 'pro' where id = auth.uid();

select column_name from information_schema.columns
where table_name = 'profiles'
  and column_name like 'stripe%' or column_name in ('subscription_status','grace_until');

select proname from pg_proc where proname = 'consume_analysis';
```
