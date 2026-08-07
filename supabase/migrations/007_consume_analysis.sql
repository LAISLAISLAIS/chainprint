-- Server-authoritative analysis quota consumption

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

  status := lower(coalesce(row.subscription_status, 'none'));
  grace := row.grace_until;
  is_pro := (
    row.plan = 'pro'
    and (
      status in ('active', 'trialing')
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
