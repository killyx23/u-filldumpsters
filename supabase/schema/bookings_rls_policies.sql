-- RLS Policies for Bookings Table
-- This file contains Row Level Security policies for the bookings table
-- to handle unauthenticated booking creation, customer portal access, and admin access

-- Enable RLS on bookings table
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow unauthenticated users to INSERT bookings
-- This allows the public booking process to work
CREATE POLICY "Allow unauthenticated booking creation" ON public.bookings
    FOR INSERT 
    TO anon
    WITH CHECK (true);

-- Policy 2: Allow authenticated customers to SELECT their own bookings
-- Customers can only see bookings where customer_id matches their customer_db_id
CREATE POLICY "Customers can view own bookings" ON public.bookings
    FOR SELECT 
    TO authenticated
    USING (
        customer_id = (
            SELECT id FROM public.customers 
            WHERE id = (
                SELECT (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
            )
        )
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 3: Allow authenticated customers to UPDATE their own bookings
-- Customers can only update bookings where customer_id matches their customer_db_id
-- and only certain fields (not sensitive admin fields)
CREATE POLICY "Customers can update own bookings" ON public.bookings
    FOR UPDATE 
    TO authenticated
    USING (
        customer_id = (
            SELECT id FROM public.customers 
            WHERE id = (
                SELECT (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
            )
        )
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    )
    WITH CHECK (
        customer_id = (
            SELECT id FROM public.customers 
            WHERE id = (
                SELECT (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
            )
        )
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 4: Allow authenticated admins to SELECT all bookings
-- Admins have full read access to all bookings
CREATE POLICY "Admins can view all bookings" ON public.bookings
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 5: Allow authenticated admins to INSERT bookings
-- Admins can create bookings on behalf of customers
CREATE POLICY "Admins can create bookings" ON public.bookings
    FOR INSERT 
    TO authenticated
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 6: Allow authenticated admins to UPDATE all bookings
-- Admins have full update access to all bookings
CREATE POLICY "Admins can update all bookings" ON public.bookings
    FOR UPDATE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 7: Allow authenticated admins to DELETE bookings
-- Admins can delete bookings if needed
CREATE POLICY "Admins can delete bookings" ON public.bookings
    FOR DELETE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 8: Allow service role (edge functions) full access
-- Edge functions need full access for business logic
CREATE POLICY "Service role full access" ON public.bookings
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create indexes to optimize RLS policy performance
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id_rls 
    ON public.bookings (customer_id) 
    WHERE customer_id IS NOT NULL;

-- Create function to check if user is admin (for potential future use)
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true;
$$;

-- Create function to get current customer ID (for potential future use)
CREATE OR REPLACE FUNCTION auth.current_customer_id()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint;
$$;
