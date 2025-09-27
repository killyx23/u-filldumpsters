-- RLS Policies for Customer Notes Table
-- This file contains Row Level Security policies for the customer_notes table
-- to handle customer portal access and admin access

-- Enable RLS on customer_notes table
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated customers to SELECT notes for their bookings
-- Customers can only see notes related to their own bookings
CREATE POLICY "Customers can view own booking notes" ON public.customer_notes
    FOR SELECT 
    TO authenticated
    USING (
        customer_id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 2: Allow authenticated customers to INSERT notes for their bookings
-- Customers can add notes to their own bookings
CREATE POLICY "Customers can create own booking notes" ON public.customer_notes
    FOR INSERT 
    TO authenticated
    WITH CHECK (
        customer_id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 3: Allow authenticated customers to UPDATE their own notes
-- Customers can update notes they created
CREATE POLICY "Customers can update own notes" ON public.customer_notes
    FOR UPDATE 
    TO authenticated
    USING (
        customer_id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
        AND
        -- Only allow updating notes that are not admin notes (if there's a field for that)
        (note_type IS NULL OR note_type != 'admin')
    )
    WITH CHECK (
        customer_id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
    );

-- Policy 4: Allow authenticated customers to DELETE their own notes
-- Customers can delete notes they created
CREATE POLICY "Customers can delete own notes" ON public.customer_notes
    FOR DELETE 
    TO authenticated
    USING (
        customer_id = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')::bigint
        AND 
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS NOT TRUE
        AND
        -- Only allow deleting notes that are not admin notes
        (note_type IS NULL OR note_type != 'admin')
    );

-- Policy 5: Allow authenticated admins to SELECT all customer notes
-- Admins have full read access to all customer notes
CREATE POLICY "Admins can view all customer notes" ON public.customer_notes
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 6: Allow authenticated admins to INSERT customer notes
-- Admins can create notes for any customer
CREATE POLICY "Admins can create customer notes" ON public.customer_notes
    FOR INSERT 
    TO authenticated
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 7: Allow authenticated admins to UPDATE all customer notes
-- Admins have full update access to all customer notes
CREATE POLICY "Admins can update all customer notes" ON public.customer_notes
    FOR UPDATE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 8: Allow authenticated admins to DELETE customer notes
-- Admins can delete any customer notes
CREATE POLICY "Admins can delete customer notes" ON public.customer_notes
    FOR DELETE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Policy 9: Allow service role (edge functions) full access
-- Edge functions need full access for business logic
CREATE POLICY "Service role full access" ON public.customer_notes
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create indexes to optimize RLS policy performance
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_id_rls 
    ON public.customer_notes (customer_id) 
    WHERE customer_id IS NOT NULL;
