-- Admin status updates (e.g. Mark as Rented) re-sync booking_resource_reservations via
-- AFTER UPDATE trigger. That table is service-role-only under RLS, so authenticated
-- admins hit: "new row violates row-level security policy" and the booking UPDATE rolls back.
--
-- Run sync/capacity helpers as SECURITY DEFINER so they can maintain reservation rows
-- without opening the table to anon/authenticated direct access.

ALTER FUNCTION public.sync_booking_reservations(bigint)
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.sync_booking_reservations_trigger()
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.check_booking_inventory_capacity()
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.resource_quantity_used(
  integer,
  date,
  time without time zone,
  time without time zone,
  bigint
)
  SECURITY DEFINER
  SET search_path = public;

COMMENT ON FUNCTION public.sync_booking_reservations(bigint) IS
  'Rebuilds booking_resource_reservations for one booking. SECURITY DEFINER so admin '
  'status/date updates can re-sync despite service-role-only RLS on the reservations table.';

COMMENT ON FUNCTION public.sync_booking_reservations_trigger() IS
  'AFTER INSERT/UPDATE trigger wrapper for sync_booking_reservations. SECURITY DEFINER.';
