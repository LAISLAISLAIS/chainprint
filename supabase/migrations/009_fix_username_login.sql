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
