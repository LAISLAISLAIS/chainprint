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
