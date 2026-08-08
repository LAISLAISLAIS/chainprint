-- Prevent clients from self-granting Pro or rewriting billing fields.
-- consume_analysis() sets a local config flag to bump analyses_used.

create or replace function public.protect_profile_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor (no JWT user)
  if auth.uid() is null then
    return new;
  end if;

  -- Privileged RPC path (see consume_analysis)
  if current_setting('chainprint.bypass_billing_guard', true) = 'on' then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.analyses_used is distinct from old.analyses_used
     or new.analyses_included is distinct from old.analyses_included
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_session_id is distinct from old.stripe_session_id
     or new.subscription_status is distinct from old.subscription_status
     or new.grace_until is distinct from old.grace_until
  then
    raise exception 'billing_fields_readonly'
      using hint = 'Plan and quota are managed by billing webhooks / consume_analysis()';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_billing on public.profiles;
create trigger profiles_protect_billing
  before update on public.profiles
  for each row
  execute function public.protect_profile_billing_columns();

drop policy if exists "Profiles are updatable by owner" on public.profiles;
drop policy if exists "Profiles owner update safe fields" on public.profiles;

create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
