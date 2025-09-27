-- RLS Policies for Customers Table
-- This file contains Row Level Security policies for the customers table
-- to handle customer portal access and admin access

-- Enable RLS on customers table
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated customers to SELECT their own customer record
-- Customers can only see their own customer record
CREATE POLICY "Customers can view own record" ON public.customers
    FOR SELECT 
    TO authenticated
    USING (
        id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 2: Allow authenticated customers to UPDATE their own customer record
-- Customers can update their own information (limited fields)
CREATE POLICY "Customers can update own record" ON public.customers
    FOR UPDATE 
    TO authenticated
    USING (
        id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    )
    WITH CHECK (
        id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 3: Allow authenticated admins to SELECT all customer records
-- Admins have full read access to all customer records
CREATE POLICY "Admins can view all customers" ON public.customers
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 4: Allow authenticated admins to INSERT customer records
-- Admins can create customer records
CREATE POLICY "Admins can create customers" ON public.customers
    FOR INSERT 
    TO authenticated
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 5: Allow authenticated admins to UPDATE all customer records
-- Admins have full update access to all customer records
CREATE POLICY "Admins can update all customers" ON public.customers
    FOR UPDATE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 6: Allow authenticated admins to DELETE customer records
-- Admins can delete customer records if needed
CREATE POLICY "Admins can delete customers" ON public.customers
    FOR DELETE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 7: Allow service role (edge functions) full access
-- Edge functions need full access for business logic
CREATE POLICY "Service role full access" ON public.customers
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create indexes to optimize RLS policy performance
CREATE INDEX IF NOT EXISTS idx_customers_customer_db_id_rls 
    ON public.customers (id) 
    WHERE id IS NOT NULL;
