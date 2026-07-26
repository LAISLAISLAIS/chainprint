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
