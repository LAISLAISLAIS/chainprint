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
