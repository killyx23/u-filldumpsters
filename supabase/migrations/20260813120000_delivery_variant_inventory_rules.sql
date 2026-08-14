-- Phase 1: give delivery-variant services the inventory rules they were missing.
--
-- A delivery variant (service 4 "Dump Loader Trailer with Delivery") consumes exactly the
-- same physical resources as its base service (service 2 "Dump Loader Trailer Rental
-- Service"); the only difference is who tows the trailer. Service 4 had no inventory_rules
-- rows at all, with two consequences:
--
--   1. get-availability skipped its capacity check entirely (it only checks resources the
--      service declares, and service 4 declared none).
--   2. Existing service-4 bookings never counted against service 2, because usage is
--      totalled by looking up rules for the *booking's* resolved service id.
--
-- Net effect: the single roll-off trailer could be sold to a delivery customer and a
-- self-pickup customer for the same day.
--
-- Rather than hardcoding service 4, this derives the variant's requirements from whatever
-- its base service declares, so any future delivery variant is covered automatically.

-- Requirements are naturally unique per (service, resource). Enforcing that lets this
-- table be upserted safely and stops accidental duplicate rows from inflating usage totals.
delete from public.inventory_rules ir
where ir.id > (
  select min(keep.id)
  from public.inventory_rules keep
  where keep.service_id = ir.service_id
    and keep.inventory_item_id = ir.inventory_item_id
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_rules_service_item_key'
      and conrelid = 'public.inventory_rules'::regclass
  ) then
    alter table public.inventory_rules
      add constraint inventory_rules_service_item_key unique (service_id, inventory_item_id);
  end if;
end $$;

insert into public.inventory_rules (service_id, inventory_item_id, quantity_required)
select distinct
       base.delivery_variant_service_id,
       ir.inventory_item_id,
       ir.quantity_required
from public.services base
join public.inventory_rules ir on ir.service_id = base.id
where base.delivery_variant_service_id is not null
on conflict (service_id, inventory_item_id) do nothing;
