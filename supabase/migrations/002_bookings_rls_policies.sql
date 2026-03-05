-- Migration: Bookings RLS Policies for Admin and Customer Portal
-- Description: Creates Row Level Security policies for bookings table
--              allowing admin users full access and customers access to their own bookings

-- ============================================================================
-- Helper Function: Check if user is admin
-- ============================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  );
$$;

COMMENT ON FUNCTION is_admin() IS 'Returns true if the current authenticated user has admin role';

-- ============================================================================
-- Helper Function: Get customer ID for current user
-- ============================================================================

CREATE OR REPLACE FUNCTION get_customer_id_for_user()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM public.customers
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_customer_id_for_user() IS 'Returns the customer ID for the current authenticated user, or NULL if not a customer';

-- ============================================================================
-- DROP EXISTING POLICIES (if they exist)
-- ============================================================================

DROP POLICY IF EXISTS "bookings_insert_for_all" ON "public"."bookings";
DROP POLICY IF EXISTS "bookings_update_all" ON "public"."bookings";
DROP POLICY IF EXISTS "admin_bookings_select_all" ON "public"."bookings";
DROP POLICY IF EXISTS "customer_bookings_select_own" ON "public"."bookings";
DROP POLICY IF EXISTS "admin_bookings_update_all" ON "public"."bookings";
DROP POLICY IF EXISTS "customer_bookings_update_own" ON "public"."bookings";
DROP POLICY IF EXISTS "admin_bookings_delete_all" ON "public"."bookings";

-- ============================================================================
-- INSERT POLICY: Allow authenticated and anonymous users to create bookings
-- ============================================================================

CREATE POLICY "bookings_insert_for_all" 
ON "public"."bookings" 
FOR INSERT 
TO "authenticated", "anon" 
WITH CHECK (true);

COMMENT ON POLICY "bookings_insert_for_all" ON "public"."bookings" IS 
'Allows authenticated and anonymous users to create bookings during the booking process';

-- ============================================================================
-- SELECT POLICIES
-- ============================================================================

-- Admin: Can SELECT all bookings
CREATE POLICY "admin_bookings_select_all" 
ON "public"."bookings" 
FOR SELECT 
TO "authenticated" 
USING (is_admin());

COMMENT ON POLICY "admin_bookings_select_all" ON "public"."bookings" IS 
'Allows admin users to view all bookings';

-- Customer: Can SELECT their own bookings
CREATE POLICY "customer_bookings_select_own" 
ON "public"."bookings" 
FOR SELECT 
TO "authenticated" 
USING (
  -- User is not an admin AND booking belongs to their customer record
  NOT is_admin() 
  AND customer_id = get_customer_id_for_user()
);

COMMENT ON POLICY "customer_bookings_select_own" ON "public"."bookings" IS 
'Allows customers to view their own bookings (where customer_id matches their customer record)';

-- ============================================================================
-- UPDATE POLICIES
-- ============================================================================

-- Admin: Can UPDATE all bookings
CREATE POLICY "admin_bookings_update_all" 
ON "public"."bookings" 
FOR UPDATE 
TO "authenticated" 
USING (is_admin())
WITH CHECK (is_admin());

COMMENT ON POLICY "admin_bookings_update_all" ON "public"."bookings" IS 
'Allows admin users to update all bookings';

-- Customer: Can UPDATE their own bookings (limited fields)
-- Note: Customers typically update via edge functions, but this allows direct updates
-- You may want to restrict which fields customers can update
CREATE POLICY "customer_bookings_update_own" 
ON "public"."bookings" 
FOR UPDATE 
TO "authenticated" 
USING (
  -- User is not an admin AND booking belongs to their customer record
  NOT is_admin() 
  AND customer_id = get_customer_id_for_user()
)
WITH CHECK (
  -- Ensure they can only update their own bookings
  NOT is_admin() 
  AND customer_id = get_customer_id_for_user()
);

COMMENT ON POLICY "customer_bookings_update_own" ON "public"."bookings" IS 
'Allows customers to update their own bookings (where customer_id matches their customer record)';

-- ============================================================================
-- DELETE POLICY
-- ============================================================================

-- Admin: Can DELETE all bookings
CREATE POLICY "admin_bookings_delete_all" 
ON "public"."bookings" 
FOR DELETE 
TO "authenticated" 
USING (is_admin());

COMMENT ON POLICY "admin_bookings_delete_all" ON "public"."bookings" IS 
'Allows admin users to delete all bookings. Note: Deletions typically go through delete-booking edge function for security';

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Ensure authenticated users have necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."bookings" TO "authenticated";
GRANT SELECT, INSERT ON "public"."bookings" TO "anon";

-- ============================================================================
-- TESTING QUERIES (commented out - remove comments to test)
-- ============================================================================

/*
-- Test 1: Check if admin function works
SELECT is_admin();

-- Test 2: Check customer ID lookup
SELECT get_customer_id_for_user();

-- Test 3: Test admin SELECT (should return all bookings if admin)
SELECT COUNT(*) FROM bookings;

-- Test 4: Test customer SELECT (should return only their bookings)
SELECT COUNT(*) FROM bookings;

-- Test 5: Test customer UPDATE (should only work on their bookings)
-- UPDATE bookings SET notes = 'Test' WHERE id = <booking_id>;
*/

-- ============================================================================
-- NOTES
-- ============================================================================

/*
IMPORTANT CONSIDERATIONS:

1. Edge Functions:
   - Most edge functions use service_role key which bypasses RLS
   - These policies only affect direct database queries from frontend

2. Customer Portal:
   - Customer portal primarily uses get-customer-details edge function
   - This policy allows direct queries if needed
   - Real-time subscriptions require SELECT access

3. Admin Console:
   - Admin users need full access for:
     - BookingsManager (calendar view)
     - CustomerDetailView (viewing customer bookings)
     - ActionItemsManager (filtering bookings)
     - ActiveRentals (updating booking status)

4. Customer Access:
   - Customers can view and update their own bookings
   - Consider adding field-level restrictions if needed
   - Customers typically don't delete bookings (use cancellation status)

5. Real-time Subscriptions:
   - Require SELECT access to work
   - Admin: Can subscribe to all bookings
   - Customer: Can subscribe to their own bookings (filtered by customer_id)

6. Performance:
   - Helper functions use SECURITY DEFINER for efficiency
   - Consider adding indexes:
     - CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
     - CREATE INDEX idx_user_roles_user_id_role ON user_roles(user_id, role);

7. Security:
   - Admin check happens first (more restrictive)
   - Customer check is secondary (less restrictive)
   - Policies are evaluated in order (first matching policy wins)
*/
