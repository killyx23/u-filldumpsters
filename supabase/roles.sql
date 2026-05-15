-- supabase/roles.sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'booking_creator') THEN
CREATE ROLE "booking_creator";
END IF;
END
$$;

GRANT "booking_creator" TO "postgres";