-- Phase 2a + 2f.1: per-requirement occupancy and scheduling granularity.
--
-- occupancy_model currently lives on services, one value per service. That is too coarse: a
-- delivered dumpster ties up the *bin* for the whole rental but the *trailer* only touches down
-- for the drop-off and pickup trips. The right granularity is the (service, resource) pair, not
-- the service alone.
--
-- Both new columns are nullable/defaulted so every existing row keeps its current, tested
-- behavior: null occupancy_model inherits services.occupancy_model exactly as before, and
-- scheduling_granularity defaults to 'day', which is what every resource has effectively been
-- until now. Nothing here changes availability or write-time capacity for existing services;
-- it only makes per-resource overrides possible going forward (see resource_quantity_used and
-- booking_reservation_rows in the next migration).
--
-- inventory_rules is read by name from get-availability and from scripts/seed data, so this
-- does not rename the table. Instead it adds a forward-looking view under the name the design
-- doc uses, service_resource_requirements, so new code can be written against the name that
-- describes what the table now models (capacity requirements, not just a boolean rule).

alter table public.inventory_rules
  add column if not exists occupancy_model public.service_occupancy_model,
  add column if not exists scheduling_granularity text not null default 'day';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_rules_scheduling_granularity_check'
      and conrelid = 'public.inventory_rules'::regclass
  ) then
    alter table public.inventory_rules
      add constraint inventory_rules_scheduling_granularity_check
      check (scheduling_granularity in ('day', 'slot'));
  end if;
end $$;

comment on column public.inventory_rules.occupancy_model is
  'Overrides services.occupancy_model for this specific resource requirement. Null inherits from the service.';
comment on column public.inventory_rules.scheduling_granularity is
  '''day'': this requirement blocks the whole day, like a rental sitting on a customer''s property. '
  '''slot'': this requirement only blocks the generated time window it is reserved for, like a delivery '
  'truck making a short trip. Only meaningful combined with a dropoff_only or dropoff_and_pickup_only '
  'occupancy model — see booking_reservation_rows in the reservations migration for how the two combine.';

create or replace view public.service_resource_requirements as
  select id,
         service_id,
         inventory_item_id,
         quantity_required,
         occupancy_model,
         scheduling_granularity
    from public.inventory_rules;

comment on view public.service_resource_requirements is
  'Forward-looking name for inventory_rules (see design doc phase 2a). A view rather than a '
  'rename because inventory_rules is read by name elsewhere; both names resolve to the same rows.';

grant select on public.service_resource_requirements to anon, authenticated, service_role;
