-- RLS Policies for Admin-Only Tables
-- This file contains Row Level Security policies for tables that should only be accessible to admins
-- and service role functions

-- Booking equipment table policies
-- Enable RLS on booking_equipment table
ALTER TABLE public.booking_equipment ENABLE ROW LEVEL SECURITY;

-- Only admins can view booking equipment
CREATE POLICY "Admins can view booking equipment" ON public.booking_equipment
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Only admins can manage booking equipment
CREATE POLICY "Admins can manage booking equipment" ON public.booking_equipment
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access booking equipment" ON public.booking_equipment
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Stripe payment info table policies
-- Enable RLS on stripe_payment_info table
ALTER TABLE public.stripe_payment_info ENABLE ROW LEVEL SECURITY;

-- Only admins can view payment info
CREATE POLICY "Admins can view payment info" ON public.stripe_payment_info
    FOR SELECT 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Only admins can manage payment info
CREATE POLICY "Admins can manage payment info" ON public.stripe_payment_info
    FOR ALL 
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
    );

-- Service role has full access
CREATE POLICY "Service role full access payment info" ON public.stripe_payment_info
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);
