-- Capacity admin tab (CapacityManager.jsx) reads inventory_items and inventory_rules with the
-- browser anon key + authenticated admin JWT. The baseline policies only allowed service_role,
-- so admins saw empty tables even though the data existed.

drop policy if exists "Allow all for admins" on public.inventory_items;
drop policy if exists "Allow all for admins" on public.inventory_rules;

create policy "inventory_items_admin_all"
  on public.inventory_items
  for all
  to authenticated
  using (public.is_admin() or auth.role() = 'service_role')
  with check (public.is_admin() or auth.role() = 'service_role');

create policy "inventory_rules_admin_all"
  on public.inventory_rules
  for all
  to authenticated
  using (public.is_admin() or auth.role() = 'service_role')
  with check (public.is_admin() or auth.role() = 'service_role');

-- Edge functions and other server-side callers use service_role.
create policy "Service role full access to inventory_items"
  on public.inventory_items
  for all
  to service_role
  using (true)
  with check (true);

create policy "Service role full access to inventory_rules"
  on public.inventory_rules
  for all
  to service_role
  using (true)
  with check (true);
