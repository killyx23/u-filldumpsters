-- Phase 3 — service groups: presentation + shared defaults.
--
-- Three concepts were squeezed into "services": what a customer buys, and how it's presented
-- alongside its siblings. This migration adds the presentation layer without touching pricing,
-- occupancy, or capacity logic — those stay exactly as Phase 1-2f left them.

create table public.service_groups (
  id integer generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text,
  display_order integer not null default 0,
  defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.service_groups is
  'Presentation grouping for services (Dumpster Rentals, Trailer Rentals, ...) plus optional '
  'shared defaults resolved by public.services_resolved for nullable per-service columns.';
comment on column public.service_groups.defaults is
  'JSONB fallback values consulted by services_resolved when a service leaves the matching '
  'column null. Supported keys today: slot_interval_minutes, price_unit, homepage_price_unit, '
  'homepage_highlight. Unknown keys are ignored, so this can grow without a migration.';

alter table public.service_groups enable row level security;

create policy "Allow anonymous read access to service_groups"
  on public.service_groups for select
  using (true);

create policy "service_groups_admin_write"
  on public.service_groups for all
  to authenticated
  using (public.is_admin() or auth.role() = 'service_role')
  with check (public.is_admin() or auth.role() = 'service_role');

create policy "Service role full access to service_groups"
  on public.service_groups for all
  to service_role
  using (true)
  with check (true);

alter table public.services
  add column group_id integer references public.service_groups(id) on delete set null;

comment on column public.services.group_id is
  'Presentation group (Phase 3). Nullable — ungrouped services (e.g. legacy protection-plan '
  'row 7) simply render outside any section and never consult group defaults.';

-- Seed the four groups called out in the plan.
insert into public.service_groups (slug, name, description, display_order, defaults)
values
  ('dumpster-rentals', 'Dumpster Rentals', 'Roll-off dumpster bins delivered to your site.', 1, '{}'::jsonb),
  ('trailer-rentals', 'Trailer Rentals', 'Dump loader trailers — tow it yourself or have it delivered.', 2, '{}'::jsonb),
  ('heavy-equipment', 'Heavy Equipment', 'Excavators and other heavy equipment rentals.', 3, '{}'::jsonb),
  ('material-delivery', 'Material Delivery', 'Rock, decorative rock, mulch, and gravel delivery.', 4, '{}'::jsonb)
on conflict (slug) do nothing;

-- Assign today's catalog to groups. Service 4 (delivery variant of 2) and service 7 (legacy
-- Premium Insurance row, not a rentable offering) are handled explicitly rather than assumed.
do $$
declare
  v_dumpster_group_id integer;
  v_trailer_group_id integer;
  v_heavy_equipment_group_id integer;
  v_material_group_id integer;
begin
  select id into v_dumpster_group_id from public.service_groups where slug = 'dumpster-rentals';
  select id into v_trailer_group_id from public.service_groups where slug = 'trailer-rentals';
  select id into v_heavy_equipment_group_id from public.service_groups where slug = 'heavy-equipment';
  select id into v_material_group_id from public.service_groups where slug = 'material-delivery';

  update public.services set group_id = v_dumpster_group_id
    where id = 1 and exists (select 1 from public.services where id = 1);

  update public.services set group_id = v_trailer_group_id
    where id in (2, 4) and exists (select 1 from public.services where id in (2, 4));

  update public.services set group_id = v_heavy_equipment_group_id
    where id = 5 and exists (select 1 from public.services where id = 5);

  update public.services set group_id = v_material_group_id
    where id = 3 and exists (select 1 from public.services where id = 3);
  -- service 7 (Premium Insurance) intentionally left ungrouped: it is a legacy protection-plan
  -- row, not a rentable offering that belongs on a presentation section.
end $$;

-- Resolves nullable per-service display fields against the parent group's defaults, so every
-- consumer (plans page, booking form, edge functions, admin) reads the same effective values
-- instead of each reimplementing the fallback. Capacity/pricing/occupancy columns are passed
-- through untouched — this view is presentation-only.
create or replace view public.services_resolved as
select
  s.*,
  g.slug as group_slug,
  g.name as group_name,
  g.description as group_description,
  g.display_order as group_display_order,
  coalesce(s.slot_interval_minutes, (g.defaults->>'slot_interval_minutes')::integer) as resolved_slot_interval_minutes,
  coalesce(s.price_unit, g.defaults->>'price_unit') as resolved_price_unit,
  coalesce(s.homepage_price_unit, g.defaults->>'homepage_price_unit') as resolved_homepage_price_unit,
  coalesce(s.homepage_highlight, g.defaults->>'homepage_highlight') as resolved_homepage_highlight
from public.services s
left join public.service_groups g on g.id = s.group_id;

comment on view public.services_resolved is
  'Phase 3 read model: services left-joined to their service_groups row, with resolved_* '
  'columns COALESCING nullable per-service fields over the group''s defaults JSONB. Plain '
  'columns (including slot_interval_minutes itself) pass through unchanged so existing '
  'consumers of services are unaffected; new code should prefer the resolved_* columns.';

grant select on public.services_resolved to anon, authenticated, service_role;
