-- Service-role-only SMS audit and verification storage.
-- RLS is enabled with no policies. anon and authenticated have no grants.

create table public.sms_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  template text,
  phone_last4 text not null,
  status text not null default 'reserved',
  brevo_message_id text,
  created_at timestamptz not null default now(),
  constraint sms_log_type_check check (type in ('notification', 'verification')),
  constraint sms_log_template_check check (template is null or template ~ '^[a-z0-9_]{1,40}$'),
  constraint sms_log_phone_last4_check check (phone_last4 ~ '^[0-9]{4}$'),
  constraint sms_log_status_check check (status in ('reserved', 'sent', 'failed')),
  constraint sms_log_message_id_check check (brevo_message_id is null or char_length(brevo_message_id) <= 64)
);

create index sms_log_user_created_idx
  on public.sms_log (user_id, created_at desc);

create index sms_log_daily_cap_idx
  on public.sms_log (created_at desc)
  where status in ('reserved', 'sent');

create table public.sms_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  phone_number text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_verification_codes_phone_check check (phone_number ~ '^[0-9]{8,15}$'),
  constraint sms_verification_codes_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint sms_verification_codes_attempts_check check (attempts >= 0 and attempts <= 5)
);

create index sms_verification_codes_user_created_idx
  on public.sms_verification_codes (user_id, created_at desc);

create index sms_verification_codes_phone_created_idx
  on public.sms_verification_codes (phone_number, created_at desc);

alter table public.sms_log enable row level security;
alter table public.sms_verification_codes enable row level security;
alter table public.sms_log force row level security;
alter table public.sms_verification_codes force row level security;

revoke all on table public.sms_log from public, anon, authenticated;
revoke all on table public.sms_verification_codes from public, anon, authenticated;
grant all on table public.sms_log to service_role;
grant all on table public.sms_verification_codes to service_role;

create or replace function public.reserve_sms_send(
  p_user_id uuid,
  p_type text,
  p_template text,
  p_phone_last4 text,
  p_phone_digits text,
  p_user_hour_limit integer,
  p_user_day_limit integer,
  p_phone_hour_limit integer,
  p_global_daily_cap integer,
  p_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_hour bigint;
  v_user_day bigint;
  v_phone_hour bigint;
  v_global bigint;
  v_log_id uuid;
  v_code_id uuid;
  v_day_start timestamptz;
begin
  if p_user_id is null or p_phone_last4 !~ '^[0-9]{4}$' or p_phone_digits !~ '^[0-9]{8,15}$' then
    raise exception 'invalid sms reservation';
  end if;
  if p_global_daily_cap is null or p_global_daily_cap < 1 then
    raise exception 'invalid sms cap';
  end if;
  if p_type not in ('notification', 'verification') then
    raise exception 'invalid sms type';
  end if;
  if p_type = 'notification' and (p_template is null or p_template !~ '^[a-z0-9_]{1,40}$' or p_code_hash is not null) then
    raise exception 'invalid notification reservation';
  end if;
  if p_type = 'verification' and (p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid verification reservation';
  end if;

  perform pg_advisory_xact_lock(874221);
  v_day_start := (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  if p_user_hour_limit is not null then
    if p_type = 'verification' then
      select count(*) into v_user_hour
      from public.sms_verification_codes
      where user_id = p_user_id
        and created_at >= now() - interval '1 hour';
    else
      select count(*) into v_user_hour
      from public.sms_log
      where user_id = p_user_id
        and type = 'notification'
        and status in ('reserved', 'sent')
        and created_at >= now() - interval '1 hour';
    end if;
    if v_user_hour >= p_user_hour_limit then
      return jsonb_build_object('allowed', false, 'reason', 'user_hour', 'log_id', null, 'code_id', null);
    end if;
  end if;

  if p_user_day_limit is not null then
    if p_type = 'verification' then
      select count(*) into v_user_day
      from public.sms_verification_codes
      where user_id = p_user_id
        and created_at >= v_day_start;
    else
      select count(*) into v_user_day
      from public.sms_log
      where user_id = p_user_id
        and type = 'notification'
        and status in ('reserved', 'sent')
        and created_at >= v_day_start;
    end if;
    if v_user_day >= p_user_day_limit then
      return jsonb_build_object('allowed', false, 'reason', 'user_day', 'log_id', null, 'code_id', null);
    end if;
  end if;

  if p_type = 'verification' and p_phone_hour_limit is not null then
    select count(*) into v_phone_hour
    from public.sms_verification_codes
    where phone_number = p_phone_digits
      and created_at >= now() - interval '1 hour';
    if v_phone_hour >= p_phone_hour_limit then
      return jsonb_build_object('allowed', false, 'reason', 'phone_hour', 'log_id', null, 'code_id', null);
    end if;
  end if;

  select count(*) into v_global
  from public.sms_log
  where status in ('reserved', 'sent')
    and created_at >= v_day_start;
  if v_global >= p_global_daily_cap then
    raise warning 'SMS daily global cap reached';
    return jsonb_build_object('allowed', false, 'reason', 'global_cap', 'log_id', null, 'code_id', null);
  end if;

  insert into public.sms_log (user_id, type, template, phone_last4, status)
  values (p_user_id, p_type, case when p_type = 'notification' then p_template else null end, p_phone_last4, 'reserved')
  returning id into v_log_id;

  if p_type = 'verification' then
    update public.sms_verification_codes
    set consumed_at = now()
    where user_id = p_user_id
      and consumed_at is null;

    insert into public.sms_verification_codes (user_id, phone_number, code_hash, expires_at)
    values (p_user_id, p_phone_digits, p_code_hash, now() + interval '10 minutes')
    returning id into v_code_id;
  end if;

  return jsonb_build_object('allowed', true, 'reason', null, 'log_id', v_log_id, 'code_id', v_code_id);
end;
$$;

create or replace function public.record_sms_code_attempt(
  p_id uuid,
  p_user_id uuid,
  p_match boolean
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempts integer;
  v_expires timestamptz;
  v_consumed timestamptz;
begin
  select attempts, expires_at, consumed_at
    into v_attempts, v_expires, v_consumed
  from public.sms_verification_codes
  where id = p_id
    and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  if v_consumed is not null then
    return jsonb_build_object('ok', false, 'reason', 'consumed');
  end if;

  if v_expires <= now() or v_attempts >= 5 then
    update public.sms_verification_codes
    set consumed_at = now()
    where id = p_id
      and consumed_at is null;
    return jsonb_build_object('ok', false, 'reason', case when v_expires <= now() then 'expired' else 'too_many' end);
  end if;

  if p_match then
    update public.sms_verification_codes
    set consumed_at = now()
    where id = p_id
      and consumed_at is null;
    return jsonb_build_object('ok', true, 'reason', null);
  end if;

  update public.sms_verification_codes
  set attempts = attempts + 1,
      consumed_at = case when attempts + 1 >= 5 then now() else null end
  where id = p_id;

  return jsonb_build_object(
    'ok',
    false,
    'reason',
    case when v_attempts + 1 >= 5 then 'too_many' else 'mismatch' end
  );
end;
$$;

revoke all on function public.reserve_sms_send(uuid, text, text, text, text, integer, integer, integer, integer, text) from public;
revoke all on function public.reserve_sms_send(uuid, text, text, text, text, integer, integer, integer, integer, text) from anon;
revoke all on function public.reserve_sms_send(uuid, text, text, text, text, integer, integer, integer, integer, text) from authenticated;
grant execute on function public.reserve_sms_send(uuid, text, text, text, text, integer, integer, integer, integer, text) to service_role;

revoke all on function public.record_sms_code_attempt(uuid, uuid, boolean) from public;
revoke all on function public.record_sms_code_attempt(uuid, uuid, boolean) from anon;
revoke all on function public.record_sms_code_attempt(uuid, uuid, boolean) from authenticated;
grant execute on function public.record_sms_code_attempt(uuid, uuid, boolean) to service_role;
