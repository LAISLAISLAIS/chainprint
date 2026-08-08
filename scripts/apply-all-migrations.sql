-- =============================================================================
-- Chainprint — apply ALL migrations (001–010) in order
-- Paste into: https://supabase.com/dashboard/project/wggvvgigtwzwivpgszyr/sql/new
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible
-- =============================================================================


-- >>> supabase/migrations/001_profiles.sql

-- Chainprint profiles (run in Supabase SQL editor or via CLI)
-- Enables real accounts: email + unique username, plans/quota.

create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null unique,
  username citext not null unique,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  analyses_used integer not null default 0 check (analyses_used >= 0),
  analyses_included integer,
  provider text not null default 'password',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$')
);

create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are insertable by owner" on public.profiles;
create policy "Profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Resolve email or username → email for password sign-in (anon-safe)
create or replace function public.resolve_login_email(identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  id_norm text := lower(trim(coalesce(identifier, '')));
  found text;
begin
  if id_norm = '' then
    return null;
  end if;

  if position('@' in id_norm) > 0 then
    select email::text into found
    from public.profiles
    where email = id_norm::citext
    limit 1;
  else
    select email::text into found
    from public.profiles
    where username = id_norm::citext
    limit 1;
  end if;

  return found;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.username_taken(u text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where username = lower(trim(u))::citext
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- Keep updated_at fresh
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profiles_updated_at();

;

-- >>> supabase/migrations/002_profile_on_signup.sql

-- Auto-create profiles on signup (fixes RLS when there is no session yet,
-- e.g. email confirmation required). Run in Supabase SQL editor after 001.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
  base text;
  suffix text;
begin
  uname := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );
  uname := regexp_replace(lower(uname), '[^a-z0-9_]', '', 'g');
  if length(uname) < 3 then
    uname := left(uname || '123', 24);
  else
    uname := left(uname, 24);
  end if;

  begin
    insert into public.profiles (id, email, username, provider, plan, analyses_used)
    values (
      new.id,
      lower(new.email),
      uname,
      coalesce(nullif(new.raw_user_meta_data->>'provider', ''), 'password'),
      'free',
      0
    );
  exception
    when unique_violation then
      -- Username clash: append a short id suffix
      base := left(uname, 17);
      suffix := left(replace(new.id::text, '-', ''), 6);
      insert into public.profiles (id, email, username, provider, plan, analyses_used)
      values (
        new.id,
        lower(new.email),
        left(base || '_' || suffix, 24),
        coalesce(nullif(new.raw_user_meta_data->>'provider', ''), 'password'),
        'free',
        0
      )
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Authenticated fallback: create/fix own profile if trigger missed it
create or replace function public.ensure_own_profile(p_username text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mail text;
  uname text;
  row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into mail from auth.users where id = uid;
  mail := lower(coalesce(mail, ''));

  uname := coalesce(
    nullif(trim(p_username), ''),
    nullif(trim((select raw_user_meta_data->>'username' from auth.users where id = uid)), ''),
    split_part(mail, '@', 1)
  );
  uname := regexp_replace(lower(uname), '[^a-z0-9_]', '', 'g');
  if length(uname) < 3 then
    uname := left(uname || '123', 24);
  else
    uname := left(uname, 24);
  end if;

  insert into public.profiles (id, email, username, provider, plan, analyses_used)
  values (uid, mail, uname, 'password', 'free', 0)
  on conflict (id) do update
    set email = excluded.email,
        username = coalesce(nullif(profiles.username, ''), excluded.username),
        updated_at = now()
  returning * into row;

  return row;
end;
$$;

revoke all on function public.ensure_own_profile(text) from public;
grant execute on function public.ensure_own_profile(text) to authenticated;

;

-- >>> supabase/migrations/003_profile_settings.sql

-- Profile settings: avatar, display name, studio defaults.
-- Run in Supabase SQL editor after 001 + 002.

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists display_name text,
  add column if not exists default_target text not null default 'vocal'
    check (default_target in ('vocal', 'instrumental', 'full')),
  add column if not exists default_mode text not null default 'standard'
    check (default_mode in ('standard', 'deep'));

-- Optional: public avatars bucket (client also supports data-URL avatars in avatar_url).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

;

-- >>> supabase/migrations/004_shared_chains.sql

-- Shareable chain pages: chainprint.app/c/?id=<uuid>
-- Anyone with the link can read; only signed-in users can create; owners can delete.

create table if not exists public.shared_chains (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users (id) on delete set null,
  track_name text,
  target text check (target in ('vocal', 'instrumental', 'full')),
  mode text check (mode in ('standard', 'deep')),
  key_label text,
  bpm numeric,
  artwork_url text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists shared_chains_owner_idx on public.shared_chains (owner);

alter table public.shared_chains enable row level security;

drop policy if exists "Shared chains are readable by anyone" on public.shared_chains;
create policy "Shared chains are readable by anyone"
  on public.shared_chains for select
  using (true);

drop policy if exists "Shared chains are insertable by owner" on public.shared_chains;
create policy "Shared chains are insertable by owner"
  on public.shared_chains for insert
  with check (auth.uid() = owner);

drop policy if exists "Shared chains are deletable by owner" on public.shared_chains;
create policy "Shared chains are deletable by owner"
  on public.shared_chains for delete
  using (auth.uid() = owner);

;

-- >>> supabase/migrations/005_shared_chains_expiry.sql

-- Shared chains: optional expiry + owner list/update policies.
-- Run in Supabase SQL editor after 004_shared_chains.sql.

alter table public.shared_chains
  add column if not exists expires_at timestamptz;

create index if not exists shared_chains_expires_idx
  on public.shared_chains (expires_at)
  where expires_at is not null;

-- Public read: live shares only (null expiry = never expires)
drop policy if exists "Shared chains are readable by anyone" on public.shared_chains;
create policy "Shared chains are readable by anyone"
  on public.shared_chains for select
  using (expires_at is null or expires_at > now());

-- Owners can always see their own rows (including expired) for Settings management
drop policy if exists "Owners can read their shared chains" on public.shared_chains;
create policy "Owners can read their shared chains"
  on public.shared_chains for select
  using (auth.uid() = owner);

drop policy if exists "Shared chains are updatable by owner" on public.shared_chains;
create policy "Shared chains are updatable by owner"
  on public.shared_chains for update
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

;

-- >>> supabase/migrations/006_billing.sql

-- Billing columns + Stripe webhook idempotency

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_session_id text,
  add column if not exists subscription_status text default 'none',
  add column if not exists grace_until timestamptz;

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_uidx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists profiles_stripe_session_id_uidx
  on public.profiles (stripe_session_id)
  where stripe_session_id is not null;

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- No policies for authenticated/anon — service role only bypasses RLS

;

-- >>> supabase/migrations/007_consume_analysis.sql

-- Server-authoritative analysis quota consumption
-- Pro predicate aligned with js/auth/quota.js hasActivePro()

create or replace function public.consume_analysis()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
  included integer;
  used integer;
  status text;
  grace timestamptz;
  is_pro boolean;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Allow trigger to accept analyses_used bump from this RPC only
  perform set_config('chainprint.bypass_billing_guard', 'on', true);

  select * into row from public.profiles where id = uid for update;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0002';
  end if;

  status := lower(coalesce(nullif(trim(row.subscription_status), ''), 'none'));
  grace := row.grace_until;
  -- Match client hasActivePro: active/trialing, legacy none, past_due within grace
  is_pro := (
    row.plan = 'pro'
    and (
      status in ('active', 'trialing', 'none')
      or (status = 'past_due' and (grace is null or grace > now()))
    )
  );

  if is_pro then
    return row;
  end if;

  included := coalesce(row.analyses_included, 1);
  used := coalesce(row.analyses_used, 0);
  if used >= included then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  update public.profiles
  set analyses_used = used + 1,
      updated_at = now()
  where id = uid
  returning * into row;

  return row;
end;
$$;

revoke all on function public.consume_analysis() from public;
grant execute on function public.consume_analysis() to authenticated;

;

-- >>> supabase/migrations/008_profiles_rls_lockdown.sql

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

;


-- >>> supabase/migrations/009_fix_username_login.sql

-- Fix username/email login: comparing citext columns to text casts citext→text
-- (case-sensitive), so lowercased identifiers never matched stored usernames
-- like LAISLAISLAIS. Cast the needle to citext instead.

create or replace function public.resolve_login_email(identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  id_norm text := lower(trim(coalesce(identifier, '')));
  found text;
begin
  if id_norm = '' then
    return null;
  end if;

  if position('@' in id_norm) > 0 then
    select email::text into found
    from public.profiles
    where email = id_norm::citext
    limit 1;
  else
    select email::text into found
    from public.profiles
    where username = id_norm::citext
    limit 1;
  end if;

  return found;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.username_taken(u text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where username = lower(trim(u))::citext
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- >>> supabase/migrations/010_transactional_emails.sql

-- Track transactional emails so welcome / Pro confirmation send once.

alter table public.profiles
  add column if not exists welcome_email_sent_at timestamptz,
  add column if not exists pro_email_sent_at timestamptz;

