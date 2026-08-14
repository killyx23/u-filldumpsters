-- Local-dev-only helper, NOT a migration.
--
-- `supabase db reset` applies every migration in supabase/migrations BEFORE loading
-- supabase/seed.sql. seed.sql is a data-only pg_dump of production, loaded with
-- session_replication_role = replica (triggers off, by design, so bulk-loading fixture rows
-- doesn't fire business-logic triggers meant for real writes).
--
-- Two consequences only show up on a truly fresh reset, never in production (where migrations
-- run against an already-populated database):
--   1. Any migration that derives data from services/inventory_rules/bookings (e.g. the Phase 1
--      delivery-variant inventory_rules fix) sees empty tables and inserts nothing.
--   2. Reservation rows for seed.sql's fixture bookings are never materialized, because the
--      trigger that would do it was intentionally disabled for the bulk load.
--
-- Run this after `supabase db reset` when you need a fully-populated local stack (matching what
-- production actually looks like) for manual testing or the verify-*.mjs scripts.

insert into public.inventory_rules (service_id, inventory_item_id, quantity_required)
select distinct
       base.delivery_variant_service_id,
       ir.inventory_item_id,
       ir.quantity_required
  from public.services base
  join public.inventory_rules ir on ir.service_id = base.id
 where base.delivery_variant_service_id is not null
on conflict (service_id, inventory_item_id) do nothing;

select public.sync_booking_reservations(id) from public.bookings;
