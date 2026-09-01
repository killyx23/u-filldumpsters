-- Delivery services move the trailer only on drop-off and pickup days. The bin stays on-site
-- for the full rental (range), but the single roll-off trailer must not be held on middle days.
--
-- Service 4 (Dump Trailer with Delivery) was incorrectly set to range for both resources in
-- 20260813180000_scheduling_requirement_data.sql. Service 1 trailer and service 3 trailer
-- already use dropoff_and_pickup_only; align service 4 with the same trip semantics.

update public.inventory_rules
set occupancy_model = 'dropoff_and_pickup_only',
    scheduling_granularity = 'slot'
where service_id = 4
  and inventory_item_id = 2;

-- Bin on a delivered dump-trailer rental remains range (customer keeps it all rental days).
update public.inventory_rules
set occupancy_model = 'range',
    scheduling_granularity = 'day'
where service_id = 4
  and inventory_item_id = 1;

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
