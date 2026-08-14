-- Phase 1b: actually enforce resource capacity when bookings are written.
--
-- Until now get-availability was the only thing checking capacity, and it does so at read
-- time. Two customers who load the calendar at the same time both see a free day, and both
-- inserts succeed. trg_check_booking_inventory existed to close that hole but was shipped
-- DISABLEd, so nothing enforced capacity on write.
--
-- Enabling it as-written would have broken normal admin work, because it re-validated every
-- row it touched: any status change on a booking that is already over capacity (including
-- cancelling it, the very thing that frees a resource) would raise. This rewrites the check
-- so it only rejects reservations that are genuinely new or larger, then enables it.
--
-- The delivery-variant mapping and the active-status list were also duplicated inline. They
-- are extracted into helpers so the trigger, later capacity queries, and get-availability
-- have a single definition to agree with.

-- Which statuses hold a resource. Lowercased so 'Confirmed' and 'confirmed' both count;
-- treating an unknown-case status as active is the safe direction to err.
create or replace function public.booking_status_is_active(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(lower(p_status), '') in (
    'confirmed',
    'rescheduled',
    'delivered',
    'waiting_to_be_returned',
    'pending_review',
    'pending_payment',
    'pending',
    'flagged'
  );
$$;

comment on function public.booking_status_is_active(text) is
  'True when a booking in this status is holding inventory and must count against capacity.';

-- A booking stores the service the customer picked. When they choose delivery, the resources
-- consumed are those of that service''s delivery variant (service 2 -> 4), because the
-- trailer is towed by us rather than the customer. Resolved from services.
-- delivery_variant_service_id rather than a hardcoded id pair.
create or replace function public.resolve_booking_service_id(p_plan jsonb, p_addons jsonb)
returns integer
language plpgsql
stable
as $$
declare
  v_plan_id_text text;
  v_base_id      integer;
  v_is_delivery  boolean;
  v_variant      integer;
begin
  v_plan_id_text := coalesce(p_plan, '{}'::jsonb) ->> 'id';
  if v_plan_id_text is null or v_plan_id_text !~ '^\d+$' then
    return null;
  end if;
  v_base_id := v_plan_id_text::integer;

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

  if not v_is_delivery then
    return v_base_id;
  end if;

  select s.delivery_variant_service_id
    into v_variant
    from public.services s
   where s.id = v_base_id;

  return coalesce(v_variant, v_base_id);
end;
$$;

comment on function public.resolve_booking_service_id(jsonb, jsonb) is
  'Service id whose inventory_rules a booking consumes, following delivery_variant_service_id when the customer chose delivery.';

-- The days a booking actually ties up its resources. Expressing occupancy as a set of days
-- (instead of comparing two occupancy models pairwise) keeps overlap tests symmetric.
create or replace function public.booking_occupied_days(
  p_occupancy text,
  p_drop_off  date,
  p_pickup    date
)
returns setof date
language sql
immutable
parallel safe
as $$
  select d::date
    from generate_series(p_drop_off, greatest(p_pickup, p_drop_off), interval '1 day') d
   where case coalesce(p_occupancy, 'range')
           when 'dropoff_only' then d::date = p_drop_off
           when 'dropoff_and_pickup_only' then d::date in (p_drop_off, p_pickup)
           else true
         end;
$$;

comment on function public.booking_occupied_days(text, date, date) is
  'Set of dates on which a booking occupies its resources, per the service occupancy_model.';

create or replace function public.check_booking_inventory_capacity()
returns trigger
language plpgsql
as $$
declare
  v_service_id integer;
  v_occupancy  text;
  v_new_days   date[];
  v_rule       record;
  v_used       integer;
begin
  -- Cancelled/completed bookings release their resources. Never block that transition, or a
  -- fully booked resource could never be freed.
  if not public.booking_status_is_active(new.status) then
    return new;
  end if;

  v_service_id := public.resolve_booking_service_id(new.plan, new.addons);
  if v_service_id is null then
    raise log '[check_booking_inventory] plan.id missing or non-numeric, skipping capacity check';
    return new;
  end if;

  -- Only re-check when the reservation is new, moves, or grows. An update that leaves the
  -- footprint alone (a status step such as Confirmed -> Delivered) already owns its capacity,
  -- and re-validating it would make any pre-existing over-capacity booking unadministerable.
  if tg_op = 'UPDATE'
     and public.booking_status_is_active(old.status)
     and old.drop_off_date = new.drop_off_date
     and old.pickup_date = new.pickup_date
     and public.resolve_booking_service_id(old.plan, old.addons) = v_service_id
  then
    return new;
  end if;

  select coalesce(s.occupancy_model::text, 'range')
    into v_occupancy
    from public.services s
   where s.id = v_service_id;
  v_occupancy := coalesce(v_occupancy, 'range');

  select coalesce(array_agg(d), '{}'::date[])
    into v_new_days
    from public.booking_occupied_days(v_occupancy, new.drop_off_date, new.pickup_date) d;

  for v_rule in
    select ir.inventory_item_id,
           ir.quantity_required,
           ii.total_quantity,
           ii.name as item_name
      from public.inventory_rules ir
      join public.inventory_items ii on ii.id = ir.inventory_item_id
     where ir.service_id = v_service_id
  loop
    -- Serialise concurrent bookings competing for this resource. Without this lock two
    -- simultaneous checkouts each read the pre-insert count and both succeed.
    perform 1 from public.inventory_items where id = v_rule.inventory_item_id for update;

    select coalesce(sum(ir2.quantity_required), 0)
      into v_used
      from public.bookings b
      join lateral (
        select public.resolve_booking_service_id(b.plan, b.addons) as service_id
      ) rb on true
      join public.inventory_rules ir2
        on ir2.service_id = rb.service_id
       and ir2.inventory_item_id = v_rule.inventory_item_id
      join public.services s2 on s2.id = rb.service_id
     where b.id is distinct from new.id
       and public.booking_status_is_active(b.status)
       -- Cheap index-friendly prefilter; the day-set test below is the precise one.
       and b.drop_off_date <= greatest(new.pickup_date, new.drop_off_date)
       and b.pickup_date >= new.drop_off_date
       and exists (
         select 1
           from public.booking_occupied_days(
                  coalesce(s2.occupancy_model::text, 'range'),
                  b.drop_off_date,
                  b.pickup_date
                ) bd
          where bd = any(v_new_days)
       );

    if v_used + v_rule.quantity_required > v_rule.total_quantity then
      -- Nearly every RAISE in this schema lands on the default P0001, so the code alone
      -- cannot tell callers what went wrong. DETAIL carries a stable marker the UI matches
      -- on to show "those dates just filled up" rather than a generic failure.
      raise exception '"%" is fully booked between % and %: % of % units already in use.',
        v_rule.item_name, new.drop_off_date, new.pickup_date, v_used, v_rule.total_quantity
        using errcode = 'P0001',
              detail  = 'booking_capacity_exceeded',
              hint    = v_rule.item_name;
    end if;
  end loop;

  return new;
end;
$$;

alter table public.bookings enable trigger trg_check_booking_inventory;
