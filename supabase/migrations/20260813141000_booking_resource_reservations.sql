-- Phase 2b + 2c + 2f.2: materialized reservations replace runtime JSONB parsing.
--
-- Both get-availability and check_booking_inventory_capacity currently re-derive "what does this
-- booking occupy" from bookings.plan/addons every time they run, inside a nested loop. That is
-- the source of the exact bug Phase 1 fixed by hand (a service with no rule, or a rule the query
-- doesn't know how to interpret, silently drops out of the capacity math). This migration writes
-- concrete reservation rows once, at write time, so every reader downstream is a plain indexed
-- aggregate instead of a JSONB-parsing interpreter.
--
-- One row per occupied day (not a single daterange row) per the design doc: a seven-day rental
-- produces seven rows, which is negligible at this business's volume and lets a slot-granular
-- requirement (2f) drop in as the same row shape with slot_start/slot_end populated.

create table if not exists public.booking_resource_reservations (
  id bigint generated always as identity primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  resource_id integer not null references public.inventory_items(id),
  quantity integer not null default 1 check (quantity > 0),
  reserved_date date not null,
  slot_start time,
  slot_end time,
  granularity text not null check (granularity in ('day', 'slot')),
  created_at timestamptz not null default now(),
  constraint brr_slot_times_consistent check (
    (granularity = 'day' and slot_start is null and slot_end is null)
    or
    (granularity = 'slot' and slot_start is not null and slot_end is not null and slot_end > slot_start)
  )
);

create index if not exists brr_lookup_idx
  on public.booking_resource_reservations (resource_id, reserved_date);

create index if not exists brr_booking_idx
  on public.booking_resource_reservations (booking_id);

-- Design doc 2f.6 suggests a partial unique index for singleton resources (trailer, excavator:
-- total_quantity = 1) as a belt-and-suspenders guard alongside the trigger's FOR UPDATE lock.
-- That is deliberately NOT added here: reservation quantity is per-booking (normally 1) rather
-- than per-resource-stock, so a plain `where quantity = 1` predicate would also match, and
-- wrongly reject, the second of two legitimate same-day bookings against a resource stocked at
-- 2+ (the 16 Yard Dumpster). Expressing "this resource's total_quantity is 1" in an index
-- predicate needs a denormalized flag or a generated column, which is more machinery than the
-- capacity guarantee is worth given the trigger's FOR UPDATE lock already serializes and
-- correctly rejects overbooking for every resource, singleton or not (see
-- scripts/verify-scheduling-capacity.mjs).

alter table public.booking_resource_reservations enable row level security;

create policy "Service role full access to booking_resource_reservations"
  on public.booking_resource_reservations
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.booking_resource_reservations is
  'One row per (booking, resource, occupied day[, slot]). Expanded from a booking''s service, '
  'dates and time windows by booking_reservation_rows / sync_booking_reservations. Read by '
  'resource_quantity_used and by get-availability; never hand-written.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- What a booking WOULD reserve — the single expansion used by both the writer and the checker
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Set-returning rather than a table write so it can be called both to materialize rows
-- (sync_booking_reservations) and to check a hypothetical booking before it is written
-- (check_booking_inventory_capacity), without the two ever computing occupancy differently.
--
-- Slot granularity is only honoured for the two "touch point" occupancy models
-- (dropoff_only, dropoff_and_pickup_only) — a short trip has a natural window. 'range' and
-- 'same_day' occupy the resource continuously with no single window to point at, so those
-- fall back to one day-granular row per occupied day regardless of the requirement's configured
-- granularity. A future admin setting scheduling_granularity = 'slot' on a range-occupancy
-- requirement degrades safely to day blocking rather than silently under-counting usage.
create or replace function public.booking_reservation_rows(
  p_service_id integer,
  p_drop_off_date date,
  p_pickup_date date,
  p_drop_off_window_start time,
  p_drop_off_window_end time,
  p_pickup_window_start time,
  p_pickup_window_end time
)
returns table (
  resource_id integer,
  quantity integer,
  reserved_date date,
  slot_start time,
  slot_end time,
  granularity text
)
language plpgsql
stable
as $$
declare
  v_req record;
  v_day date;
begin
  for v_req in
    select ir.inventory_item_id,
           ir.quantity_required,
           ir.scheduling_granularity,
           coalesce(ir.occupancy_model::text, s.occupancy_model::text, 'range') as occupancy_model
      from public.inventory_rules ir
      join public.services s on s.id = ir.service_id
     where ir.service_id = p_service_id
  loop
    if v_req.scheduling_granularity = 'slot'
       and v_req.occupancy_model in ('dropoff_only', 'dropoff_and_pickup_only')
    then
      resource_id := v_req.inventory_item_id;
      quantity := v_req.quantity_required;
      reserved_date := p_drop_off_date;
      slot_start := coalesce(p_drop_off_window_start, time '00:00:00');
      slot_end := coalesce(p_drop_off_window_end, time '23:59:59');
      granularity := 'slot';
      return next;

      if v_req.occupancy_model = 'dropoff_and_pickup_only' and p_pickup_date is not null then
        resource_id := v_req.inventory_item_id;
        quantity := v_req.quantity_required;
        reserved_date := p_pickup_date;
        slot_start := coalesce(p_pickup_window_start, time '00:00:00');
        slot_end := coalesce(p_pickup_window_end, time '23:59:59');
        granularity := 'slot';
        return next;
      end if;
    else
      for v_day in
        select d from public.booking_occupied_days(v_req.occupancy_model, p_drop_off_date, p_pickup_date) d
      loop
        resource_id := v_req.inventory_item_id;
        quantity := v_req.quantity_required;
        reserved_date := v_day;
        slot_start := null;
        slot_end := null;
        granularity := 'day';
        return next;
      end loop;
    end if;
  end loop;
  return;
end;
$$;

comment on function public.booking_reservation_rows(integer, date, date, time, time, time, time) is
  'What a booking with this service/dates/windows would reserve. Shared by sync_booking_reservations '
  '(to write rows) and check_booking_inventory_capacity (to check before writing), so the two cannot drift.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Materialize reservations for one booking
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.sync_booking_reservations(p_booking_id bigint)
returns void
language plpgsql
as $$
declare
  v_booking record;
  v_service_id integer;
begin
  delete from public.booking_resource_reservations where booking_id = p_booking_id;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    return;
  end if;
  if not public.booking_status_is_active(v_booking.status) then
    return;
  end if;

  v_service_id := public.resolve_booking_service_id(v_booking.plan, v_booking.addons);
  if v_service_id is null then
    return;
  end if;

  insert into public.booking_resource_reservations
    (booking_id, resource_id, quantity, reserved_date, slot_start, slot_end, granularity)
  select p_booking_id, r.resource_id, r.quantity, r.reserved_date, r.slot_start, r.slot_end, r.granularity
    from public.booking_reservation_rows(
           v_service_id,
           v_booking.drop_off_date,
           v_booking.pickup_date,
           v_booking.drop_off_window_start,
           v_booking.drop_off_window_end,
           v_booking.pickup_window_start,
           v_booking.pickup_window_end
         ) r;
end;
$$;

comment on function public.sync_booking_reservations(bigint) is
  'Replaces this booking''s reservation rows to match its current service/dates/status. '
  'A cancelled or otherwise inactive booking ends up with zero rows, which is how cancelling '
  'releases a resource. Called from trg_bookings_sync_reservations after every relevant write.';

-- Triggers can't take arguments, so this thin wrapper is what actually gets attached; it is the
-- only reason sync_booking_reservations(bigint) isn't called directly from CREATE TRIGGER.
create or replace function public.sync_booking_reservations_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.sync_booking_reservations(new.id);
  return new;
end;
$$;

drop trigger if exists trg_bookings_sync_reservations on public.bookings;
create trigger trg_bookings_sync_reservations
  after insert or update of
    status, drop_off_date, pickup_date, plan, addons,
    drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end
  on public.bookings
  for each row execute function public.sync_booking_reservations_trigger();

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Shared capacity function (2f.2): day and slot reservations block each other symmetrically.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.resource_quantity_used(
  p_resource_id integer,
  p_date date,
  p_slot_start time default null,
  p_slot_end time default null,
  p_exclude_booking_id bigint default null
) returns integer
language sql
stable
as $$
  select coalesce(sum(r.quantity), 0)::integer
  from public.booking_resource_reservations r
  where r.resource_id = p_resource_id
    and r.reserved_date = p_date
    and (p_exclude_booking_id is null or r.booking_id <> p_exclude_booking_id)
    and (
      r.granularity = 'day'                                          -- a day reservation blocks any request
      or p_slot_start is null                                        -- a day request is blocked by any slot reservation
      or (r.slot_start < p_slot_end and r.slot_end > p_slot_start)    -- slot vs slot overlap
    );
$$;

comment on function public.resource_quantity_used(integer, date, time, time, bigint) is
  'How much of a resource is already reserved for a date (p_slot_start null) or a specific '
  'time window. The one function both get-availability''s bulk read and the write-time trigger '
  'reason about, so read-time and write-time capacity cannot drift apart.';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Write-time guard, rewritten against reservations instead of re-parsing bookings.plan
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.check_booking_inventory_capacity()
returns trigger
language plpgsql
as $$
declare
  v_service_id integer;
  v_row record;
  v_total integer;
  v_name text;
  v_used integer;
begin
  if not public.booking_status_is_active(new.status) then
    return new;
  end if;

  v_service_id := public.resolve_booking_service_id(new.plan, new.addons);
  if v_service_id is null then
    raise log '[check_booking_inventory] plan.id missing or non-numeric, skipping capacity check';
    return new;
  end if;

  -- Only re-check when the reservation footprint is new, moves, or changes shape. A status
  -- step that leaves dates/windows/service alone (e.g. Confirmed -> Delivered) already owns
  -- its capacity, and re-validating it would make a pre-existing over-capacity booking
  -- unadministerable.
  if tg_op = 'UPDATE'
     and public.booking_status_is_active(old.status)
     and old.drop_off_date = new.drop_off_date
     and old.pickup_date = new.pickup_date
     and old.drop_off_window_start is not distinct from new.drop_off_window_start
     and old.drop_off_window_end is not distinct from new.drop_off_window_end
     and old.pickup_window_start is not distinct from new.pickup_window_start
     and old.pickup_window_end is not distinct from new.pickup_window_end
     and public.resolve_booking_service_id(old.plan, old.addons) = v_service_id
  then
    return new;
  end if;

  for v_row in
    select *
      from public.booking_reservation_rows(
             v_service_id,
             new.drop_off_date,
             new.pickup_date,
             new.drop_off_window_start,
             new.drop_off_window_end,
             new.pickup_window_start,
             new.pickup_window_end
           )
  loop
    select ii.total_quantity, ii.name into v_total, v_name
      from public.inventory_items ii
     where ii.id = v_row.resource_id;

    -- Serialises concurrent bookings competing for this resource. Without this lock two
    -- simultaneous checkouts each read the pre-insert count and both succeed.
    perform 1 from public.inventory_items where id = v_row.resource_id for update;

    -- Excludes this booking's own (not-yet-replaced) reservation rows, which matters on
    -- UPDATE: the old rows are still present until the AFTER trigger re-syncs them.
    v_used := public.resource_quantity_used(v_row.resource_id, v_row.reserved_date, v_row.slot_start, v_row.slot_end, new.id);

    if v_used + v_row.quantity > v_total then
      raise exception '"%" is fully booked between % and %: % of % units already in use.',
        v_name, new.drop_off_date, new.pickup_date, v_used, v_total
        using errcode = 'P0001',
              detail  = 'booking_capacity_exceeded',
              hint    = v_name;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.check_booking_inventory_capacity() is
  'BEFORE INSERT OR UPDATE guard on bookings. Phase 2 rewrite of the Phase 1b trigger: capacity '
  'is now read from booking_resource_reservations via resource_quantity_used, the same function '
  'get-availability uses, instead of re-deriving usage from bookings.plan/addons JSONB.';

-- The trigger itself (name, timing, and enable state) is unchanged from Phase 1b; only the
-- function body it calls changed, so no ALTER TRIGGER / re-enable is needed here.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Backfill: materialize reservations for every booking that already exists
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in select id from public.bookings loop
    perform public.sync_booking_reservations(v_booking.id);
    v_count := v_count + 1;
  end loop;
  raise notice '[booking_resource_reservations] backfilled reservations for % booking(s)', v_count;
end $$;
