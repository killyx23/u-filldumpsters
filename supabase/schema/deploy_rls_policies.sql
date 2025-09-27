-- Deployment Script for All RLS Policies
-- This script applies all Row Level Security policies to the database
-- Run this script in your Supabase SQL editor or via migration

-- Note: Make sure all tables exist before running this script
-- The script will enable RLS and create policies for:

-- 1. Bookings table - Core booking functionality
-- 2. Customers table - Customer portal access
-- 3. Customer notes table - Customer communication
-- 4. Public tables - Services, equipment, availability, etc.
-- 5. Admin-only tables - Payment info, booking equipment, etc.

-- Apply bookings RLS policies
\i supabase/schema/bookings_rls_policies.sql

-- Apply customers RLS policies  
\i supabase/schema/customers_rls_policies.sql

-- Apply customer notes RLS policies
\i supabase/schema/customer_notes_rls_policies.sql

-- Apply public tables RLS policies
\i supabase/schema/public_tables_rls_policies.sql

-- Apply admin-only tables RLS policies
\i supabase/schema/admin_only_tables_rls_policies.sql

-- Verify RLS is enabled on all tables
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
    AND tablename IN (
        'bookings', 'customers', 'customer_notes', 'services', 
        'equipment', 'service_availability', 'unavailable_dates',
        'contact_messages', 'booking_equipment', 'stripe_payment_info'
    )
ORDER BY tablename;

-- List all policies created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
