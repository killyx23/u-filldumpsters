-- Phase 1c: give bookings machine-comparable time windows.
--
-- drop_off_time_slot / pickup_time_slot are plain text and hold four mutually incompatible
-- formats depending on which code path wrote the row:
--
--   '6:00 AM'             hourly self-pickup, auto-set in BookingForm
--   '06:00:00'            TimeSlotPicker storing a get-availability slot value
--   '06:00:00|08:00:00'   the plans 1/4 fetchedPickupWindows override
--   '08:00|17:00'         RescheduleDateTimeSelector's fallback
--
-- Nothing can compare those, which blocks slot-level capacity and already causes live bugs:
-- pinTiming.ts only regex-matches the 12-hour form, so every other row silently falls back to
-- hardcoded PIN hours, and PortalCalendar builds `date || 'T' || slot`, which is an invalid
-- timestamp for the pipe formats.
--
-- This adds typed start/end columns alongside the text, parses all four formats in one place,
-- and keeps the columns filled by trigger so no writer can reintroduce the drift. The text
-- columns stay as the display/audit value so receipts, emails, and portal views are untouched.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Parsing
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- One clock reading -> time. Components are pulled out with a regex rather than to_timestamp
-- so that odd spacing ('6:00AM') parses and unrecognised input returns null instead of raising.
create or replace function public.parse_clock_time(p_value text)
returns time
language plpgsql
immutable
parallel safe
as $$
declare
  v_raw   text;
  v_parts text[];
  v_hour  integer;
begin
  v_raw := upper(btrim(coalesce(p_value, '')));
  if v_raw = '' then
    return null;
  end if;

  v_parts := regexp_match(v_raw, '^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$');
  if v_parts is not null then
    v_hour := (v_parts[1])::integer % 12;
    if v_parts[4] = 'PM' then
      v_hour := v_hour + 12;
    end if;
    return make_time(v_hour, (v_parts[2])::integer, coalesce((v_parts[3])::integer, 0));
  end if;

  v_parts := regexp_match(v_raw, '^(\d{1,2}):(\d{2})(?::(\d{2}))?$');
  if v_parts is not null then
    v_hour := (v_parts[1])::integer;
    if v_hour > 23 then
      return null;
    end if;
    return make_time(v_hour, (v_parts[2])::integer, coalesce((v_parts[3])::integer, 0));
  end if;

  return null;
end;
$$;

comment on function public.parse_clock_time(text) is
  'Parses HH:mm, HH:mm:ss and h:mm AM/PM into time. Returns null for anything unrecognised.';

-- A stored slot -> (start, end). Returns no rows when the slot cannot be interpreted, so
-- callers keep nulls rather than inventing a window.
--
-- p_span_minutes is how long a single-valued slot lasts. Pass 0 for services whose slot is an
-- instant rather than a window (see service_slot_span_minutes).
create or replace function public.parse_booking_time_slot(
  p_slot text,
  p_span_minutes integer default 120
)
returns table (window_start time, window_end time)
language plpgsql
immutable
parallel safe
as $$
declare
  v_raw   text;
  v_start time;
  v_end   time;
  v_span  integer;
begin
  v_raw := btrim(coalesce(p_slot, ''));
  if v_raw = '' then
    return;
  end if;

  if position('|' in v_raw) > 0 then
    v_start := public.parse_clock_time(split_part(v_raw, '|', 1));
    v_end   := public.parse_clock_time(split_part(v_raw, '|', 2));
    if v_start is null or v_end is null then
      return;
    end if;
  else
    v_start := public.parse_clock_time(v_raw);
    if v_start is null then
      return;
    end if;
    v_span := greatest(coalesce(p_span_minutes, 0), 0);
    v_end := v_start + make_interval(mins => v_span);
    -- A late slot plus its span can wrap past midnight, which would leave end < start and
    -- break every overlap test. Clamp to the end of the day instead.
    if v_span > 0 and v_end <= v_start then
      v_end := time '23:59:59';
    end if;
  end if;

  return query select v_start, v_end;
end;
$$;

comment on function public.parse_booking_time_slot(text, integer) is
  'Normalises any stored booking time slot format into a (start, end) window. No rows when unparseable.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- How long a slot lasts, per service
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- get-availability carries this as a hardcoded intervalMap keyed by service id. Storing it on
-- the service lets the parser, the backfill, and (later) slot generation agree on one value.
alter table public.services
  add column if not exists slot_interval_minutes integer;

comment on column public.services.slot_interval_minutes is
  'Length of one generated booking slot, in minutes. Replaces the hardcoded intervalMap in get-availability.';

update public.services set slot_interval_minutes = 120 where id in (1, 4) and slot_interval_minutes is null;
update public.services set slot_interval_minutes = 60  where id in (2, 3, 5, 8) and slot_interval_minutes is null;

-- Hourly self-pickup services do not store a window at all: drop_off_time_slot is the time the
-- customer collects and pickup_time_slot is a return-by deadline. Giving those a span would
-- invent an occupancy window that does not exist, so they collapse to a single instant.
create or replace function public.service_slot_span_minutes(p_service_id integer)
returns integer
language sql
stable
parallel safe
as $$
  select case
           when s.service_type = 'hourly' then 0
           else coalesce(s.slot_interval_minutes, 120)
         end
    from public.services s
   where s.id = p_service_id;
$$;

comment on function public.service_slot_span_minutes(integer) is
  'Minutes a single-valued time slot spans for a service; 0 when the slot is an instant, not a window.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Service resolution, shared by bookings and pending_customers
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.resolve_service_id_for_delivery(
  p_service_id integer,
  p_is_delivery boolean
)
returns integer
language sql
stable
as $$
  select case
           when p_service_id is null then null
           when coalesce(p_is_delivery, false) then coalesce(
             (select s.delivery_variant_service_id from public.services s where s.id = p_service_id),
             p_service_id
           )
           else p_service_id
         end;
$$;

comment on function public.resolve_service_id_for_delivery(integer, boolean) is
  'Applies services.delivery_variant_service_id when a booking is for delivery.';

-- Reimplemented on top of the shared helper; behaviour is unchanged.
create or replace function public.resolve_booking_service_id(p_plan jsonb, p_addons jsonb)
returns integer
language plpgsql
stable
as $$
declare
  v_plan_id_text text;
  v_is_delivery  boolean;
begin
  v_plan_id_text := coalesce(p_plan, '{}'::jsonb) ->> 'id';
  if v_plan_id_text is null or v_plan_id_text !~ '^\d+$' then
    return null;
  end if;

  v_is_delivery := coalesce(
    case
      when jsonb_typeof(coalesce(p_addons, '{}'::jsonb) -> 'isDelivery') = 'boolean'
        then (p_addons -> 'isDelivery')::boolean
      when lower(coalesce(p_addons, '{}'::jsonb) ->> 'isDelivery') in ('true', '1')
        then true
      else false
    end,
    false
  );

  return public.resolve_service_id_for_delivery(v_plan_id_text::integer, v_is_delivery);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Typed columns
-- ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.bookings
  add column if not exists drop_off_window_start time,
  add column if not exists drop_off_window_end   time,
  add column if not exists pickup_window_start   time,
  add column if not exists pickup_window_end     time;

alter table public.pending_customers
  add column if not exists drop_off_window_start time,
  add column if not exists drop_off_window_end   time,
  add column if not exists pickup_window_start   time,
  add column if not exists pickup_window_end     time;

comment on column public.bookings.drop_off_window_start is
  'Parsed from drop_off_time_slot. The text column remains the display value.';
comment on column public.bookings.pickup_window_start is
  'Parsed from pickup_time_slot. The text column remains the display value.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Keep them filled
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Deriving in the database rather than in each writer means the frontend, the RPCs, and the
-- reschedule edge function cannot drift back apart. A caller that supplies typed values
-- explicitly is respected; otherwise they are parsed from the text slot.
create or replace function public.normalize_booking_time_windows()
returns trigger
language plpgsql
as $$
declare
  v_service_id integer;
  v_span       integer;
  v_window     record;
begin
  if tg_table_name = 'pending_customers' then
    v_service_id := public.resolve_service_id_for_delivery(new.service_id, new.delivery_service);
  else
    v_service_id := public.resolve_booking_service_id(new.plan, new.addons);
  end if;

  v_span := coalesce(public.service_slot_span_minutes(v_service_id), 120);

  if new.drop_off_window_start is null
     or (tg_op = 'UPDATE'
         and new.drop_off_time_slot is distinct from old.drop_off_time_slot
         and new.drop_off_window_start is not distinct from old.drop_off_window_start)
  then
    select w.window_start, w.window_end
      into v_window
      from public.parse_booking_time_slot(new.drop_off_time_slot, v_span) w;
    new.drop_off_window_start := v_window.window_start;
    new.drop_off_window_end   := v_window.window_end;
  end if;

  if new.pickup_window_start is null
     or (tg_op = 'UPDATE'
         and new.pickup_time_slot is distinct from old.pickup_time_slot
         and new.pickup_window_start is not distinct from old.pickup_window_start)
  then
    select w.window_start, w.window_end
      into v_window
      from public.parse_booking_time_slot(new.pickup_time_slot, v_span) w;
    new.pickup_window_start := v_window.window_start;
    new.pickup_window_end   := v_window.window_end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_normalize_time_windows on public.bookings;
create trigger trg_bookings_normalize_time_windows
  before insert or update of drop_off_time_slot, pickup_time_slot, plan, addons
  on public.bookings
  for each row execute function public.normalize_booking_time_windows();

drop trigger if exists trg_pending_customers_normalize_time_windows on public.pending_customers;
create trigger trg_pending_customers_normalize_time_windows
  before insert or update of drop_off_time_slot, pickup_time_slot, service_id, delivery_service
  on public.pending_customers
  for each row execute function public.normalize_booking_time_windows();

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Backfill
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Only the window columns are written, which matters because the other triggers on bookings
-- are scoped to status/addons/date changes and so stay dormant here. coalesce keeps the
-- statement idempotent and never overwrites a value a caller set deliberately.
update public.bookings b
   set drop_off_window_start = coalesce(b.drop_off_window_start, w.drop_start),
       drop_off_window_end   = coalesce(b.drop_off_window_end,   w.drop_end),
       pickup_window_start   = coalesce(b.pickup_window_start,   w.pick_start),
       pickup_window_end     = coalesce(b.pickup_window_end,     w.pick_end)
  from (
    select bk.id,
           d.window_start as drop_start,
           d.window_end   as drop_end,
           p.window_start as pick_start,
           p.window_end   as pick_end
      from public.bookings bk
      cross join lateral (
        select coalesce(
                 public.service_slot_span_minutes(
                   public.resolve_booking_service_id(bk.plan, bk.addons)
                 ),
                 120
               ) as span
      ) s
      left join lateral public.parse_booking_time_slot(bk.drop_off_time_slot, s.span) d on true
      left join lateral public.parse_booking_time_slot(bk.pickup_time_slot,   s.span) p on true
     where bk.drop_off_window_start is null
        or bk.pickup_window_start is null
  ) w
 where b.id = w.id;

update public.pending_customers pc
   set drop_off_window_start = coalesce(pc.drop_off_window_start, w.drop_start),
       drop_off_window_end   = coalesce(pc.drop_off_window_end,   w.drop_end),
       pickup_window_start   = coalesce(pc.pickup_window_start,   w.pick_start),
       pickup_window_end     = coalesce(pc.pickup_window_end,     w.pick_end)
  from (
    select src.id,
           d.window_start as drop_start,
           d.window_end   as drop_end,
           p.window_start as pick_start,
           p.window_end   as pick_end
      from public.pending_customers src
      cross join lateral (
        select coalesce(
                 public.service_slot_span_minutes(
                   public.resolve_service_id_for_delivery(src.service_id, src.delivery_service)
                 ),
                 120
               ) as span
      ) s
      left join lateral public.parse_booking_time_slot(src.drop_off_time_slot, s.span) d on true
      left join lateral public.parse_booking_time_slot(src.pickup_time_slot,   s.span) p on true
     where src.drop_off_window_start is null
        or src.pickup_window_start is null
  ) w
 where pc.id = w.id;

-- Any row whose slot text could not be interpreted is left null and reported here rather than
-- defaulted to an invented window, so it can be corrected by hand.
do $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select id, drop_off_time_slot, pickup_time_slot
      from public.bookings
     where (drop_off_time_slot is not null and btrim(drop_off_time_slot) <> '' and drop_off_window_start is null)
        or (pickup_time_slot is not null and btrim(pickup_time_slot) <> '' and pickup_window_start is null)
  loop
    v_count := v_count + 1;
    raise warning '[normalize_booking_time_windows] booking % has an unparseable slot: drop_off=%, pickup=%',
      v_row.id, v_row.drop_off_time_slot, v_row.pickup_time_slot;
  end loop;

  if v_count = 0 then
    raise notice '[normalize_booking_time_windows] all booking time slots parsed cleanly';
  else
    raise warning '[normalize_booking_time_windows] % booking(s) need manual review', v_count;
  end if;
end $$;
