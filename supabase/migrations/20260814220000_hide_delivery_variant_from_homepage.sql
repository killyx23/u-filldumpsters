-- Keep dump-trailer self-pickup (2) and delivery (4) as one customer SKU:
-- 2 is the homepage card; 4 is the checkbox variant. Also hide any other row that is
-- someone else's delivery_variant_service_id so catalogs never list twins side by side.

update public.services
set delivery_variant_service_id = 4
where id = 2
  and exists (select 1 from public.services where id = 4)
  and delivery_variant_service_id is distinct from 4;

update public.services as variant
set show_on_homepage = false
where exists (
  select 1
  from public.services as base
  where base.delivery_variant_service_id = variant.id
)
  and variant.show_on_homepage is distinct from false;

update public.services
set show_on_homepage = false
where id = 4
  and show_on_homepage is distinct from false;
