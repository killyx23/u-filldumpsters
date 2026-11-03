-- CREATE OR REPLACE with an added default arg created a second overload.
-- Existing 4-arg callers still hit the old body without the 24h / not_before
-- guards. Drop the stale overload so all calls use the fixed 5-arg function.

DROP FUNCTION IF EXISTS public.find_converted_checkout_sibling(text, bigint, date, date);

GRANT EXECUTE ON FUNCTION public.find_converted_checkout_sibling(text, bigint, date, date, timestamptz)
  TO anon, authenticated, service_role;
