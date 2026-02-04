# Harmonized Duplicate Booking Prevention Plan

## Executive Summary

This plan addresses duplicate booking vulnerabilities across all service types **without modifying existing application code**. Solutions are implemented at the database level and through new edge functions that can be called independently.

---

## Service Type Analysis

### Service ID 1: 16 Yard Dumpster Rental
- **service_type**: `window`
- **Booking Pattern**: Multi-day rental (delivery date → pickup date)
- **Time Slots**: Delivery windows (120-min intervals), Pickup windows (120-min intervals)
- **Risk Level**: **HIGH** - Multi-day bookings block inventory for extended periods
- **Double Booking Risk**: Multiple `pending_payment` bookings can overlap date ranges

### Service ID 2: Dump Loader Trailer Rental (Self-Pickup)
- **service_type**: `hourly`
- **Booking Pattern**: Same-day or multi-day (pickup date → return date)
- **Time Slots**: Pickup slots (60-min intervals), Return slots (60-min intervals)
- **Risk Level**: **HIGH** - Same-day bookings create tight windows for conflicts
- **Double Booking Risk**: Fast booking cycle increases race condition likelihood

### Service ID 3: Rock, Mulch, Gravel
- **service_type**: `window`
- **Booking Pattern**: Single delivery (delivery date only)
- **Time Slots**: Delivery windows (60-min intervals)
- **Risk Level**: **MEDIUM** - Single-day reduces overlap risk, but still vulnerable
- **Double Booking Risk**: Multiple deliveries scheduled for same time slot

### Service ID 4: Dump Loader Trailer with Delivery
- **service_type**: `window`
- **Booking Pattern**: Multi-day rental (delivery date → pickup date)
- **Time Slots**: Delivery windows (120-min intervals), Pickup windows (120-min intervals)
- **Risk Level**: **HIGH** - Similar to Service 1, multi-day + delivery scheduling
- **Double Booking Risk**: Same as Service 1, compounded by delivery logistics

---

## Current Vulnerability

### The Problem

1. **Booking Creation Flow**:
   ```
   User selects dates → Booking created (status: 'pending_payment') 
   → Equipment inventory decremented → Payment processed → Status: 'Confirmed'
   ```

2. **Availability Check Flow**:
   ```
   get-availability() → Checks bookings with statuses:
   ['Confirmed', 'Rescheduled', 'Delivered', 'waiting_to_be_returned', 'pending_review']
   → Does NOT check 'pending_payment'
   ```

3. **Race Condition**:
   - User A creates booking → `pending_payment`, inventory decremented
   - User B checks availability → sees slot as available
   - User B creates booking → `pending_payment`, inventory decremented again
   - Both complete payment → **DUPLICATE BOOKINGS**

---

## Solution Strategy: Multi-Layer Defense

### Layer 1: Database-Level Constraints (Primary Defense)

#### Option A: Database Function for Availability Check (Recommended)

Create a PostgreSQL function that checks availability **including `pending_payment`** bookings:

```sql
CREATE OR REPLACE FUNCTION check_booking_availability(
  p_service_id INTEGER,
  p_drop_off_date DATE,
  p_pickup_date DATE,
  p_drop_off_time_slot TEXT,
  p_pickup_time_slot TEXT,
  p_exclude_booking_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conflicting_bookings INTEGER;
  v_service_id_for_check INTEGER;
BEGIN
  -- Handle service ID mapping (Service 2 with delivery → Service 4)
  -- Note: This would need to check addons.isDelivery from bookings
  -- For now, we'll check both service_id 2 and 4 if p_service_id is 2
  
  -- Check for overlapping bookings with active statuses
  SELECT COUNT(*) INTO v_conflicting_bookings
  FROM bookings b
  WHERE (
    -- Check if date ranges overlap
    (p_drop_off_date <= b.pickup_date AND p_pickup_date >= b.drop_off_date)
    AND
    -- Check if service matches (handle service 2/4 mapping)
    (
      (p_service_id = 2 AND (b.plan->>'id')::INTEGER = 2 AND (b.addons->>'isDelivery')::BOOLEAN = false)
      OR
      (p_service_id = 4 AND ((b.plan->>'id')::INTEGER = 2 AND (b.addons->>'isDelivery')::BOOLEAN = true))
      OR
      (p_service_id NOT IN (2, 4) AND (b.plan->>'id')::INTEGER = p_service_id)
    )
    AND
    -- Check for active statuses (including pending_payment)
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
```

**Usage**: Call this function before inserting/updating bookings to prevent duplicates.

#### Option B: Database Trigger (Automatic Prevention)

Create a trigger that prevents duplicate bookings at insert time:

```sql
CREATE OR REPLACE FUNCTION prevent_duplicate_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflicting_count INTEGER;
  v_service_id INTEGER;
  v_is_delivery BOOLEAN;
BEGIN
  -- Extract service ID from plan JSONB
  v_service_id := (NEW.plan->>'id')::INTEGER;
  v_is_delivery := COALESCE((NEW.addons->>'isDelivery')::BOOLEAN, false);
  
  -- Map service 2 with delivery to service 4
  IF v_service_id = 2 AND v_is_delivery THEN
    v_service_id := 4;
  END IF;
  
  -- Check for overlapping bookings
  SELECT COUNT(*) INTO v_conflicting_count
  FROM bookings b
  WHERE b.id != NEW.id
    AND (
      -- Date range overlap
      (NEW.drop_off_date <= b.pickup_date AND NEW.pickup_date >= b.drop_off_date)
      AND
      -- Same service (handle service 2/4 mapping)
      (
        (v_service_id = 2 AND (b.plan->>'id')::INTEGER = 2 AND COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = false)
        OR
        (v_service_id = 4 AND (b.plan->>'id')::INTEGER = 2 AND COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = true)
        OR
        (v_service_id NOT IN (2, 4) AND (b.plan->>'id')::INTEGER = v_service_id)
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
    );
  
  -- Prevent insert if conflicts exist
  IF v_conflicting_count > 0 THEN
    RAISE EXCEPTION 'Booking conflict: Another booking already exists for this service and date range with status %', 
      (SELECT status FROM bookings WHERE id IN (
        SELECT id FROM bookings 
        WHERE (drop_off_date <= NEW.pickup_date AND pickup_date >= NEW.drop_off_date)
        AND status IN ('pending_payment', 'Confirmed', 'Rescheduled', 'Delivered', 'waiting_to_be_returned', 'pending_review')
        LIMIT 1
      ));
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_duplicate_booking_before_insert
BEFORE INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_booking();
```

**Note**: This is more aggressive and will reject bookings. May need refinement for edge cases.

---

### Layer 2: New Edge Function (Secondary Defense)

Create a new edge function `check-booking-conflict` that can be called before booking creation:

```typescript
// supabase/functions/check-booking-conflict/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { 
      serviceId, 
      dropOffDate, 
      pickupDate, 
      dropOffTimeSlot, 
      pickupTimeSlot,
      excludeBookingId 
    } = await req.json();
    
    if (!serviceId || !dropOffDate || !pickupDate) {
      throw new Error("Service ID, drop-off date, and pickup date are required.");
    }
    
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Call the database function
    const { data, error } = await supabaseAdmin.rpc('check_booking_availability', {
      p_service_id: serviceId,
      p_drop_off_date: dropOffDate,
      p_pickup_date: pickupDate,
      p_drop_off_time_slot: dropOffTimeSlot || null,
      p_pickup_time_slot: pickupTimeSlot || null,
      p_exclude_booking_id: excludeBookingId || null
    });
    
    if (error) throw error;
    
    return new Response(JSON.stringify({
      available: data,
      message: data ? 'Slot is available' : 'Slot is already booked'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
```

**Usage**: Frontend can call this before showing "Book Now" button or before creating booking.

---

### Layer 3: Cleanup Job (Maintenance)

Create a scheduled job to clean up abandoned `pending_payment` bookings:

```sql
-- Function to clean up abandoned bookings
CREATE OR REPLACE FUNCTION cleanup_abandoned_bookings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
  v_timeout_minutes INTEGER := 30; -- 30 minutes timeout
BEGIN
  -- Cancel bookings that are pending_payment for more than timeout
  UPDATE bookings
  SET status = 'Cancelled',
      notes = COALESCE(notes, '') || ' [Auto-cancelled: Payment not completed within ' || v_timeout_minutes || ' minutes]'
  WHERE status = 'pending_payment'
    AND created_at < NOW() - (v_timeout_minutes || ' minutes')::INTERVAL
    AND id NOT IN (
      -- Don't cancel if payment is in progress (has Stripe session)
      SELECT booking_id 
      FROM stripe_payment_info 
      WHERE booking_id = bookings.id
    );
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  -- Increment equipment quantities back
  -- Note: This would need to call increment_equipment_quantities RPC
  -- Implementation depends on your equipment tracking
  
  RETURN v_deleted_count;
END;
$$;
```

**Schedule**: Run every 5-10 minutes via pg_cron or external cron job.

---

## Service-Specific Considerations

### Service 1 & 4 (Multi-Day Window Services)

**Additional Check**: Verify entire date range is available, not just start/end dates.

```sql
-- Enhanced check for multi-day bookings
-- Ensure no conflicts on ANY day in the range
SELECT COUNT(*) 
FROM bookings b
WHERE (
  -- Check each day in the range overlaps
  EXISTS (
    SELECT 1 
    FROM generate_series(p_drop_off_date, p_pickup_date, '1 day'::INTERVAL) AS check_date
    WHERE check_date::DATE BETWEEN b.drop_off_date AND b.pickup_date
  )
  AND
  -- Service and status checks...
);
```

### Service 2 (Hourly/Same-Day Service)

**Additional Check**: Verify time slots don't conflict for same-day bookings.

```sql
-- For same-day bookings, check time slot conflicts
IF p_drop_off_date = p_pickup_date THEN
  -- Check if time slots overlap
  -- This requires parsing time slots and checking intervals
  -- Implementation depends on time slot format
END IF;
```

### Service 3 (Single Delivery)

**Simplified Check**: Only need to check delivery date and time slot.

```sql
-- For single-day services, simpler overlap check
WHERE p_drop_off_date = b.drop_off_date
  AND p_drop_off_time_slot = b.drop_off_time_slot
```

---

## Implementation Plan

### Phase 1: Database Functions (Week 1)
1. ✅ Create `check_booking_availability()` function
2. ✅ Test with all service types
3. ✅ Add indexes for performance:
   ```sql
   CREATE INDEX idx_bookings_status_dates ON bookings(status, drop_off_date, pickup_date);
   CREATE INDEX idx_bookings_plan_service ON bookings USING GIN(plan);
   CREATE INDEX idx_bookings_addons_delivery ON bookings USING GIN(addons);
   ```

### Phase 2: Edge Function (Week 1-2)
1. ✅ Create `check-booking-conflict` edge function
2. ✅ Deploy and test
3. ✅ Document API usage

### Phase 3: Cleanup Job (Week 2)
1. ✅ Create `cleanup_abandoned_bookings()` function
2. ✅ Set up pg_cron or external scheduler
3. ✅ Monitor and adjust timeout as needed

### Phase 4: Optional Trigger (Week 3)
1. ⚠️ **Optional**: Add database trigger for automatic prevention
2. ⚠️ Test thoroughly - may need to handle edge cases
3. ⚠️ Consider making it a warning instead of blocking

### Phase 5: Monitoring (Ongoing)
1. ✅ Add logging for conflict detection
2. ✅ Monitor abandoned booking cleanup
3. ✅ Track duplicate booking attempts

---

## Testing Strategy

### Test Cases by Service Type

#### Service 1 (16 Yard Dumpster)
- ✅ Test: Multi-day booking (Mon-Fri) conflicts with existing Tue-Thu booking
- ✅ Test: Overlapping date ranges with different time slots
- ✅ Test: Same date range, different statuses

#### Service 2 (Dump Loader Self-Pickup)
- ✅ Test: Same-day booking conflicts (same pickup/return times)
- ✅ Test: Multi-day booking overlaps
- ✅ Test: Fast sequential bookings (race condition simulation)

#### Service 3 (Rock/Mulch/Gravel)
- ✅ Test: Same delivery date/time conflicts
- ✅ Test: Multiple deliveries same day, different times

#### Service 4 (Dump Loader with Delivery)
- ✅ Test: Same as Service 1, but verify service ID mapping (2→4)
- ✅ Test: Delivery vs self-pickup don't conflict (different service IDs)

---

## Rollback Plan

If issues arise:
1. **Disable trigger** (if implemented): `DROP TRIGGER check_duplicate_booking_before_insert ON bookings;`
2. **Keep database function**: Can be called manually for verification
3. **Keep cleanup job**: Helps prevent abandoned bookings
4. **Monitor**: Check logs for false positives

---

## Performance Considerations

### Indexes Needed
```sql
-- Composite index for common queries
CREATE INDEX idx_bookings_availability_check 
ON bookings(status, drop_off_date, pickup_date, (plan->>'id'), (addons->>'isDelivery'));

-- Partial index for pending_payment (most common check)
CREATE INDEX idx_bookings_pending_payment 
ON bookings(drop_off_date, pickup_date) 
WHERE status = 'pending_payment';
```

### Query Optimization
- Use `EXPLAIN ANALYZE` to verify index usage
- Consider partitioning by date if table grows large
- Cache availability results for short periods (30-60 seconds)

---

## Success Metrics

- **Zero duplicate bookings** after implementation
- **< 1% false positives** (legitimate bookings rejected)
- **< 5% abandoned bookings** (pending_payment cleaned up)
- **< 100ms** average response time for availability checks

---

## Next Steps

1. Review and approve this plan
2. Implement Phase 1 (Database Functions)
3. Test with staging data
4. Deploy to production
5. Monitor and iterate

---

## Appendix: Service Type Reference

| Service ID | Name | service_type | Booking Pattern | Risk Level |
|------------|------|--------------|-----------------|------------|
| 1 | 16 Yard Dumpster | window | Multi-day (delivery→pickup) | HIGH |
| 2 | Dump Loader (Self) | hourly | Same-day or multi-day (pickup→return) | HIGH |
| 3 | Rock/Mulch/Gravel | window | Single delivery | MEDIUM |
| 4 | Dump Loader (Delivery) | window | Multi-day (delivery→pickup) | HIGH |
