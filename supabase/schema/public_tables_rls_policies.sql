-- RLS Policies for Public Tables (Services, Equipment, etc.)
-- This file contains Row Level Security policies for tables that need public read access
-- for the booking process but restricted write access

-- Services table policies
-- Enable RLS on services table
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Allow public read access to services (needed for booking process)
CREATE POLICY "Public can view services" ON public.services
    FOR SELECT 
    TO anon, authenticated
    USING (true);

-- Only admins can modify services
CREATE POLICY "Admins can manage services" ON public.services
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access services" ON public.services
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Equipment table policies
-- Enable RLS on equipment table
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

-- Allow public read access to equipment (needed for booking process)
CREATE POLICY "Public can view equipment" ON public.equipment
    FOR SELECT 
    TO anon, authenticated
    USING (true);

-- Only admins can modify equipment
CREATE POLICY "Admins can manage equipment" ON public.equipment
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access equipment" ON public.equipment
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Service availability table policies
-- Enable RLS on service_availability table
ALTER TABLE public.service_availability ENABLE ROW LEVEL SECURITY;

-- Allow public read access to service availability (needed for booking process)
CREATE POLICY "Public can view service availability" ON public.service_availability
    FOR SELECT 
    TO anon, authenticated
    USING (true);

-- Only admins can modify service availability
CREATE POLICY "Admins can manage service availability" ON public.service_availability
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access service availability" ON public.service_availability
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Unavailable dates table policies
-- Enable RLS on unavailable_dates table
ALTER TABLE public.unavailable_dates ENABLE ROW LEVEL SECURITY;

-- Allow public read access to unavailable dates (needed for booking process)
CREATE POLICY "Public can view unavailable dates" ON public.unavailable_dates
    FOR SELECT 
    TO anon, authenticated
    USING (true);

-- Only admins can modify unavailable dates
CREATE POLICY "Admins can manage unavailable dates" ON public.unavailable_dates
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access unavailable dates" ON public.unavailable_dates
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Contact messages table policies
-- Enable RLS on contact_messages table
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Allow public to insert contact messages
CREATE POLICY "Public can create contact messages" ON public.contact_messages
    FOR INSERT 
    TO anon, authenticated
    WITH CHECK (true);

-- Only admins can view contact messages
CREATE POLICY "Admins can view contact messages" ON public.contact_messages
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Only admins can modify contact messages
CREATE POLICY "Admins can manage contact messages" ON public.contact_messages
    FOR UPDATE, DELETE 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access contact messages" ON public.contact_messages
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);
