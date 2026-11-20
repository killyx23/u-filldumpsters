-- A delivered dump trailer stays at the customer from drop-off through pickup.
-- 20260831120000 treated service 4 like a dumpster trip (trailer reserved only on the
-- drop-off and pickup windows). That left the single roll-off trailer free on the
-- days in between, so self-pickup and another delivery could be booked on top of it.
--
-- Dumpster rental (service 1) and material delivery (service 3) still use
-- dropoff_and_pickup_only / slot: those jobs only need the trailer for the trip.
-- The 16-yard dumpster rule on service 4 is unchanged.

update public.inventory_rules
set occupancy_model = 'range',
    scheduling_granularity = 'day'
where service_id = 4
  and inventory_item_id = 2;

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
