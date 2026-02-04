-- Migration: Prevent Duplicate Bookings
-- Description: Adds database-level functions and triggers to prevent duplicate bookings
--              across all service types without modifying existing application code

-- ============================================================================
-- FUNCTION: check_booking_availability
-- Purpose: Check if a booking slot is available, including pending_payment bookings
-- ============================================================================

CREATE OR REPLACE FUNCTION check_booking_availability(
  p_service_id INTEGER,
  p_drop_off_date DATE,
  p_pickup_date DATE,
  p_drop_off_time_slot TEXT DEFAULT NULL,
  p_pickup_time_slot TEXT DEFAULT NULL,
  p_exclude_booking_id BIGINT DEFAULT NULL,
  p_is_delivery BOOLEAN DEFAULT false
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicting_bookings INTEGER;
  v_service_id_for_check INTEGER;
  v_plan_id INTEGER;
BEGIN
  -- Handle service ID mapping
  -- Service 2 with delivery → Service 4
  IF p_service_id = 2 AND p_is_delivery THEN
    v_service_id_for_check := 4;
  ELSE
    v_service_id_for_check := p_service_id;
  END IF;
  
  -- Check for overlapping bookings with active statuses
  SELECT COUNT(*) INTO v_conflicting_bookings
  FROM bookings b
  WHERE (
    -- Date range overlap: bookings overlap if start1 <= end2 AND start2 <= end1
    (p_drop_off_date <= b.pickup_date AND p_pickup_date >= b.drop_off_date)
    AND
    -- Service matching logic
    (
      -- Service 2 (self-pickup) - check bookings with plan.id = 2 and isDelivery = false
      (v_service_id_for_check = 2 AND 
       (b.plan->>'id')::INTEGER = 2 AND 
       COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = false)
      OR
      -- Service 4 (with delivery) - check bookings with plan.id = 2 and isDelivery = true
      (v_service_id_for_check = 4 AND 
       (b.plan->>'id')::INTEGER = 2 AND 
       COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = true)
      OR
      -- Other services - direct match
      (v_service_id_for_check NOT IN (2, 4) AND 
       (b.plan->>'id')::INTEGER = v_service_id_for_check)
    )
    AND
    -- Active statuses (including pending_payment)
    b.status IN (
      'pending_payment',
      'Confirmed',
      'Rescheduled',
      'Delivered',
      'waiting_to_be_returned',
      'pending_review'
    )
    AND
    -- Exclude current booking if updating
    (p_exclude_booking_id IS NULL OR b.id != p_exclude_booking_id)
  );
  
  -- Return true if no conflicts (available), false if conflicts exist
  RETURN v_conflicting_bookings = 0;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_booking_availability TO authenticated, anon, service_role;

COMMENT ON FUNCTION check_booking_availability IS 
'Checks if a booking slot is available by verifying no overlapping bookings exist with active statuses (including pending_payment). Returns true if available, false if conflict exists.';

-- ============================================================================
-- FUNCTION: get_conflicting_bookings
-- Purpose: Get details of conflicting bookings (for debugging/admin)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_conflicting_bookings(
  p_service_id INTEGER,
  p_drop_off_date DATE,
  p_pickup_date DATE,
  p_exclude_booking_id BIGINT DEFAULT NULL,
  p_is_delivery BOOLEAN DEFAULT false
) RETURNS TABLE (
  booking_id BIGINT,
  status TEXT,
  drop_off_date DATE,
  pickup_date DATE,
  customer_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_id_for_check INTEGER;
BEGIN
  -- Handle service ID mapping
  IF p_service_id = 2 AND p_is_delivery THEN
    v_service_id_for_check := 4;
  ELSE
    v_service_id_for_check := p_service_id;
  END IF;
  
  RETURN QUERY
  SELECT 
    b.id AS booking_id,
    b.status,
    b.drop_off_date,
    b.pickup_date,
    b.name AS customer_name,
    b.created_at
  FROM bookings b
  WHERE (
    -- Date range overlap
    (p_drop_off_date <= b.pickup_date AND p_pickup_date >= b.drop_off_date)
    AND
    -- Service matching
    (
      (v_service_id_for_check = 2 AND 
       (b.plan->>'id')::INTEGER = 2 AND 
       COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = false)
      OR
      (v_service_id_for_check = 4 AND 
       (b.plan->>'id')::INTEGER = 2 AND 
       COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = true)
      OR
      (v_service_id_for_check NOT IN (2, 4) AND 
       (b.plan->>'id')::INTEGER = v_service_id_for_check)
    )
    AND
    -- Active statuses
    b.status IN (
      'pending_payment',
      'Confirmed',
      'Rescheduled',
      'Delivered',
      'waiting_to_be_returned',
      'pending_review'
    )
    AND
    -- Exclude current booking
    (p_exclude_booking_id IS NULL OR b.id != p_exclude_booking_id)
  )
  ORDER BY b.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_conflicting_bookings TO authenticated, anon, service_role;

COMMENT ON FUNCTION get_conflicting_bookings IS 
'Returns details of bookings that conflict with the given service and date range. Useful for debugging and admin purposes.';

-- ============================================================================
-- FUNCTION: cleanup_abandoned_bookings
-- Purpose: Clean up bookings that have been pending_payment for too long
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_abandoned_bookings(
  p_timeout_minutes INTEGER DEFAULT 30
) RETURNS TABLE (
  cancelled_count INTEGER,
  booking_ids BIGINT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_count INTEGER;
  v_booking_ids BIGINT[];
BEGIN
  -- Cancel bookings that are pending_payment for more than timeout
  -- and don't have an associated Stripe payment session
  WITH cancelled_bookings AS (
    UPDATE bookings
    SET 
      status = 'Cancelled',
      notes = COALESCE(notes || E'\n', '') || 
              '[Auto-cancelled: Payment not completed within ' || p_timeout_minutes || ' minutes]'
    WHERE status = 'pending_payment'
      AND created_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL
      AND id NOT IN (
        -- Don't cancel if payment is in progress (has Stripe session)
        SELECT booking_id 
        FROM stripe_payment_info 
        WHERE booking_id IS NOT NULL
      )
    RETURNING id
  )
  SELECT 
    COUNT(*),
    ARRAY_AGG(id)
  INTO v_cancelled_count, v_booking_ids
  FROM cancelled_bookings;
  
  -- Note: Equipment quantities should be incremented back
  -- This would require calling increment_equipment_quantities RPC
  -- Implementation depends on your equipment tracking system
  
  RETURN QUERY SELECT 
    COALESCE(v_cancelled_count, 0) AS cancelled_count,
    COALESCE(v_booking_ids, ARRAY[]::BIGINT[]) AS booking_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_abandoned_bookings TO service_role;

COMMENT ON FUNCTION cleanup_abandoned_bookings IS 
'Cancels bookings that have been pending_payment for longer than the specified timeout. Returns count and IDs of cancelled bookings.';

-- ============================================================================
-- INDEXES: Improve query performance
-- ============================================================================

-- Composite index for availability checks
CREATE INDEX IF NOT EXISTS idx_bookings_availability_check 
ON bookings(status, drop_off_date, pickup_date)
WHERE status IN (
  'pending_payment',
  'Confirmed',
  'Rescheduled',
  'Delivered',
  'waiting_to_be_returned',
  'pending_review'
);

-- Index for pending_payment cleanup queries
CREATE INDEX IF NOT EXISTS idx_bookings_pending_payment_cleanup
ON bookings(created_at)
WHERE status = 'pending_payment';

-- GIN index for JSONB plan field (for service ID lookups)
CREATE INDEX IF NOT EXISTS idx_bookings_plan_gin
ON bookings USING GIN(plan);

-- GIN index for JSONB addons field (for isDelivery lookups)
CREATE INDEX IF NOT EXISTS idx_bookings_addons_gin
ON bookings USING GIN(addons);

-- ============================================================================
-- OPTIONAL: Trigger for automatic prevention
-- WARNING: This will REJECT bookings if conflicts exist
-- Consider testing thoroughly before enabling
-- ============================================================================

/*
CREATE OR REPLACE FUNCTION prevent_duplicate_booking_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicting_count INTEGER;
  v_service_id INTEGER;
  v_is_delivery BOOLEAN;
BEGIN
  -- Extract service ID from plan JSONB
  v_service_id := (NEW.plan->>'id')::INTEGER;
  v_is_delivery := COALESCE((NEW.addons->>'isDelivery')::BOOLEAN, false);
  
  -- Check availability using the function
  IF NOT check_booking_availability(
    p_service_id := v_service_id,
    p_drop_off_date := NEW.drop_off_date,
    p_pickup_date := NEW.pickup_date,
    p_exclude_booking_id := NEW.id,
    p_is_delivery := v_is_delivery
  ) THEN
    RAISE EXCEPTION 'Booking conflict: Another booking already exists for this service and date range. Use get_conflicting_bookings() to see details.';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger (commented out - enable after testing)
-- CREATE TRIGGER check_duplicate_booking_before_insert
-- BEFORE INSERT ON bookings
-- FOR EACH ROW
-- EXECUTE FUNCTION prevent_duplicate_booking_trigger();
*/

-- ============================================================================
-- TESTING: Example usage queries
-- ============================================================================

/*
-- Test availability check for Service 1 (16 Yard Dumpster)
SELECT check_booking_availability(
  p_service_id := 1,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15',
  p_is_delivery := false
);

-- Test availability check for Service 2 (Dump Loader Self-Pickup)
SELECT check_booking_availability(
  p_service_id := 2,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-10',
  p_is_delivery := false
);

-- Test availability check for Service 4 (Dump Loader with Delivery)
SELECT check_booking_availability(
  p_service_id := 2,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15',
  p_is_delivery := true
);

-- Get conflicting bookings (for debugging)
SELECT * FROM get_conflicting_bookings(
  p_service_id := 1,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15'
);

-- Cleanup abandoned bookings (run via cron)
SELECT * FROM cleanup_abandoned_bookings(p_timeout_minutes := 30);
*/
