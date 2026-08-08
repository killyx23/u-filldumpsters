-- Local + reproducible data fix: trailer requirements for delivered / trip-based services.
-- Self-pickup service 2 keeps range + day (trailer gone all day).

-- Service 1: delivered dumpster — bin on-site all rental days, trailer only on drop/pickup trips.
insert into public.inventory_rules (service_id, inventory_item_id, quantity_required, occupancy_model, scheduling_granularity)
values (1, 2, 1, 'dropoff_and_pickup_only', 'slot')
on conflict (service_id, inventory_item_id) do update set
  quantity_required = excluded.quantity_required,
  occupancy_model = excluded.occupancy_model,
  scheduling_granularity = excluded.scheduling_granularity;

-- Service 3: material delivery — same trip pattern for the trailer.
update public.inventory_rules
set occupancy_model = 'dropoff_and_pickup_only',
    scheduling_granularity = 'slot'
where service_id = 3 and inventory_item_id = 2;

-- Service 4: delivery variant — mirror delivered trip semantics for trailer.
update public.inventory_rules
set occupancy_model = 'dropoff_and_pickup_only',
    scheduling_granularity = 'slot'
where service_id = 4 and inventory_item_id = 2;

-- Re-sync reservations for any active bookings so capacity reflects new rules.
do $$
declare v_id bigint;
begin
  for v_id in select id from public.bookings where status not in ('Cancelled', 'Completed') loop
    perform public.sync_booking_reservations(v_id);
  end loop;
end $$;
