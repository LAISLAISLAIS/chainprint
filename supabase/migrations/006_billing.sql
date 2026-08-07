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
