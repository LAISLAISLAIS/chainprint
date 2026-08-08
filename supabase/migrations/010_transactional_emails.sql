-- Track transactional emails so welcome / Pro confirmation send once.

alter table public.profiles
  add column if not exists welcome_email_sent_at timestamptz,
  add column if not exists pro_email_sent_at timestamptz;
