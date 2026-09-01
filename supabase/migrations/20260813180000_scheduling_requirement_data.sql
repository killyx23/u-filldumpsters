-- Production data for the scheduling resource model.
--
-- Seed.sql is a replica-role dump, so these upserts also run again at the end of seed.sql
-- after a local db reset. All statements are idempotent.

-- Delivery variants inherit the base service's resource list (service 2 → 4).
-- Catalog rows come from seed.sql on a fresh reset. Skip upserts whose FKs are not present yet;
-- the same statements run again at the end of seed.sql.

insert into public.inventory_rules (service_id, inventory_item_id, quantity_required)
select distinct
       base.delivery_variant_service_id,
       ir.inventory_item_id,
       ir.quantity_required
from public.services base
join public.inventory_rules ir on ir.service_id = base.id
where base.delivery_variant_service_id is not null
on conflict (service_id, inventory_item_id) do nothing;

insert into public.inventory_rules (
  service_id, inventory_item_id, quantity_required, occupancy_model, scheduling_granularity
)
select 1, 2, 1, 'dropoff_and_pickup_only', 'slot'
where exists (select 1 from public.services where id = 1)
  and exists (select 1 from public.inventory_items where id = 2)
on conflict (service_id, inventory_item_id) do update set
  quantity_required = excluded.quantity_required,
  occupancy_model = excluded.occupancy_model,
  scheduling_granularity = excluded.scheduling_granularity;

update public.inventory_rules
set occupancy_model = 'range',
    scheduling_granularity = 'day'
where service_id = 2
  and inventory_item_id in (1, 2);

update public.inventory_rules
set occupancy_model = 'dropoff_and_pickup_only',
    scheduling_granularity = 'slot'
where service_id = 3 and inventory_item_id = 2;

-- Service 4: bin held for the full rental; trailer only on drop-off/pickup trip days.
update public.inventory_rules
set occupancy_model = 'range',
    scheduling_granularity = 'day'
where service_id = 4
  and inventory_item_id = 1;

update public.inventory_rules
set occupancy_model = 'dropoff_and_pickup_only',
    scheduling_granularity = 'slot'
where service_id = 4
  and inventory_item_id = 2;

-- Mini telescoping loader (service 8) is its own machine, not the excavator.
insert into public.inventory_items (id, name, type, total_quantity)
values (5, 'Mini Telescoping Loader', 'loader', 1)
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type;

insert into public.inventory_rules (
  service_id, inventory_item_id, quantity_required, occupancy_model, scheduling_granularity
)
select 8, 5, 1, 'range', 'day'
where exists (select 1 from public.services where id = 8)
on conflict (service_id, inventory_item_id) do update set
  quantity_required = excluded.quantity_required,
  occupancy_model = excluded.occupancy_model,
  scheduling_granularity = excluded.scheduling_granularity;

select setval(
  'public.inventory_items_id_seq',
  greatest(coalesce((select max(id) from public.inventory_items), 1), 5),
  true
);
select setval(
  'public.inventory_rules_id_seq',
  greatest(coalesce((select max(id) from public.inventory_rules), 1), 1),
  true
);

grant select, insert, update, delete on public.booking_resource_reservations to anon, authenticated, service_role;
grant select, insert, update, delete on public.service_groups to anon, authenticated, service_role;

do $$
declare
  v_seq text;
begin
  v_seq := pg_get_serial_sequence('public.booking_resource_reservations', 'id');
  if v_seq is not null then
    execute format('grant usage, select on sequence %s to anon, authenticated, service_role', v_seq);
  end if;
  v_seq := pg_get_serial_sequence('public.service_groups', 'id');
  if v_seq is not null then
    execute format('grant usage, select on sequence %s to anon, authenticated, service_role', v_seq);
  end if;
end $$;

grant execute on function public.booking_status_is_active(text) to anon, authenticated, service_role;
grant execute on function public.resolve_booking_service_id(jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.resolve_service_id_for_delivery(integer, boolean) to anon, authenticated, service_role;
grant execute on function public.booking_occupied_days(text, date, date) to anon, authenticated, service_role;
grant execute on function public.parse_clock_time(text) to anon, authenticated, service_role;
grant execute on function public.parse_booking_time_slot(text, integer) to anon, authenticated, service_role;
grant execute on function public.service_slot_span_minutes(integer) to anon, authenticated, service_role;
grant execute on function public.booking_reservation_rows(integer, date, date, time, time, time, time) to anon, authenticated, service_role;
grant execute on function public.sync_booking_reservations(bigint) to anon, authenticated, service_role;
grant execute on function public.resource_quantity_used(integer, date, time, time, bigint) to anon, authenticated, service_role;

-- Re-materialize reservations so existing bookings pick up the new requirement shapes.
do $$
declare v_id bigint;
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sync_booking_reservations'
  ) then
    for v_id in select id from public.bookings loop
      perform public.sync_booking_reservations(v_id);
    end loop;
  end if;
end $$;
