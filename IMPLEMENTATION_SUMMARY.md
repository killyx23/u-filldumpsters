# Duplicate Booking Prevention - Implementation Summary

## Quick Start

This plan provides **database-level duplicate booking prevention** that works **without modifying existing application code**.

---

## What Was Created

### 1. **Comprehensive Plan Document**
   - `DUPLICATE_BOOKING_PREVENTION_PLAN.md`
   - Full analysis of all service types
   - Multi-layer defense strategy
   - Testing and rollback plans

### 2. **SQL Migration File**
   - `supabase/migrations/001_prevent_duplicate_bookings.sql`
   - Production-ready database functions
   - Indexes for performance
   - Optional trigger (commented out)

### 3. **Documentation**
   - `AVAILABILITY_TABLES_EXPLANATION.md`
   - Explains how availability tables work

---

## Key Functions Created

### `check_booking_availability()`
**Purpose**: Check if a booking slot is available (including `pending_payment` bookings)

**Usage**:
```sql
SELECT check_booking_availability(
  p_service_id := 1,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15',
  p_is_delivery := false
);
-- Returns: true (available) or false (conflict exists)
```

**What it does**:
- Checks for overlapping date ranges
- Handles service ID mapping (Service 2 with delivery → Service 4)
- Includes `pending_payment` status in conflict checks
- Works for all service types

### `get_conflicting_bookings()`
**Purpose**: Get details of conflicting bookings (for debugging/admin)

**Usage**:
```sql
SELECT * FROM get_conflicting_bookings(
  p_service_id := 1,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15'
);
-- Returns: List of conflicting bookings with details
```

### `cleanup_abandoned_bookings()`
**Purpose**: Clean up bookings stuck in `pending_payment` status

**Usage**:
```sql
SELECT * FROM cleanup_abandoned_bookings(p_timeout_minutes := 30);
-- Returns: Count and IDs of cancelled bookings
```

**Schedule**: Run every 5-10 minutes via pg_cron or external scheduler

---

## How It Works

### Current Problem
```
User A: Creates booking → status: 'pending_payment' → inventory decremented
User B: Checks availability → doesn't see User A's booking → books same slot
Result: DUPLICATE BOOKINGS when both complete payment
```

### Solution
```
User A: Creates booking → status: 'pending_payment' → inventory decremented
User B: Checks availability → calls check_booking_availability() → sees User A's booking → slot unavailable
Result: NO DUPLICATE BOOKINGS
```

---

## Service Type Handling

### Service 1: 16 Yard Dumpster Rental
- **Type**: Multi-day window service
- **Check**: Entire date range overlap
- **Status**: ✅ Handled

### Service 2: Dump Loader Trailer (Self-Pickup)
- **Type**: Hourly/same-day service
- **Check**: Date range + time slot overlap
- **Status**: ✅ Handled (with service ID mapping)

### Service 3: Rock, Mulch, Gravel
- **Type**: Single delivery
- **Check**: Delivery date + time slot
- **Status**: ✅ Handled

### Service 4: Dump Loader Trailer (Delivery)
- **Type**: Multi-day window service
- **Check**: Entire date range overlap (mapped from Service 2)
- **Status**: ✅ Handled (service ID mapping: 2→4)

---

## Implementation Steps

### Step 1: Run Migration
```bash
# Apply the migration to your database
psql -d your_database -f supabase/migrations/001_prevent_duplicate_bookings.sql
```

Or via Supabase Dashboard:
1. Go to SQL Editor
2. Copy/paste contents of migration file
3. Run

### Step 2: Test Functions
```sql
-- Test Service 1
SELECT check_booking_availability(1, '2026-02-10', '2026-02-15', NULL, NULL, NULL, false);

-- Test Service 2 (self-pickup)
SELECT check_booking_availability(2, '2026-02-10', '2026-02-10', NULL, NULL, NULL, false);

-- Test Service 4 (delivery)
SELECT check_booking_availability(2, '2026-02-10', '2026-02-15', NULL, NULL, NULL, true);
```

### Step 3: Set Up Cleanup Job
```sql
-- Via pg_cron (if enabled)
SELECT cron.schedule(
  'cleanup-abandoned-bookings',
  '*/10 * * * *', -- Every 10 minutes
  $$SELECT cleanup_abandoned_bookings(30)$$
);
```

Or use external cron:
```bash
# Every 10 minutes
*/10 * * * * psql -d your_database -c "SELECT cleanup_abandoned_bookings(30);"
```

### Step 4: (Optional) Create Edge Function
Create `supabase/functions/check-booking-conflict/index.ts` as documented in the plan.

### Step 5: (Optional) Enable Trigger
**⚠️ WARNING**: Only enable after thorough testing!

Uncomment the trigger section in the migration file and test:
```sql
CREATE TRIGGER check_duplicate_booking_before_insert
BEFORE INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_booking_trigger();
```

---

## Integration Options

### Option A: Call Function Before Booking Creation
In your application code (when ready to modify):
```typescript
// Before creating booking
const { data: isAvailable } = await supabase.rpc('check_booking_availability', {
  p_service_id: serviceId,
  p_drop_off_date: dropOffDate,
  p_pickup_date: pickupDate,
  p_is_delivery: isDelivery
});

if (!isAvailable) {
  throw new Error('This time slot is no longer available');
}
```

### Option B: Use Edge Function
Create `check-booking-conflict` edge function (see plan document) and call from frontend.

### Option C: Enable Database Trigger
Enable the trigger (after testing) for automatic prevention at database level.

---

## Performance

### Indexes Created
- `idx_bookings_availability_check`: Composite index for availability queries
- `idx_bookings_pending_payment_cleanup`: Index for cleanup job
- `idx_bookings_plan_gin`: GIN index for plan JSONB
- `idx_bookings_addons_gin`: GIN index for addons JSONB

### Expected Performance
- Availability check: **< 50ms** (with indexes)
- Cleanup job: **< 100ms** (depends on abandoned bookings count)

---

## Monitoring

### Check for Conflicts
```sql
-- See if there are any duplicate bookings
SELECT 
  plan->>'id' as service_id,
  drop_off_date,
  pickup_date,
  COUNT(*) as booking_count,
  ARRAY_AGG(id) as booking_ids,
  ARRAY_AGG(status) as statuses
FROM bookings
WHERE status IN ('pending_payment', 'Confirmed', 'Rescheduled', 'Delivered', 'waiting_to_be_returned', 'pending_review')
GROUP BY plan->>'id', drop_off_date, pickup_date
HAVING COUNT(*) > 1
ORDER BY booking_count DESC;
```

### Monitor Cleanup Job
```sql
-- Check how many bookings were cleaned up
SELECT * FROM cleanup_abandoned_bookings(30);

-- See pending_payment bookings older than 30 minutes
SELECT 
  id,
  name,
  email,
  drop_off_date,
  pickup_date,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/60 as minutes_old
FROM bookings
WHERE status = 'pending_payment'
  AND created_at < NOW() - INTERVAL '30 minutes'
ORDER BY created_at;
```

---

## Rollback

If you need to rollback:

```sql
-- Drop functions
DROP FUNCTION IF EXISTS check_booking_availability CASCADE;
DROP FUNCTION IF EXISTS get_conflicting_bookings CASCADE;
DROP FUNCTION IF EXISTS cleanup_abandoned_bookings CASCADE;

-- Drop trigger (if enabled)
DROP TRIGGER IF EXISTS check_duplicate_booking_before_insert ON bookings;
DROP FUNCTION IF EXISTS prevent_duplicate_booking_trigger CASCADE;

-- Drop indexes (optional - they don't hurt if left)
DROP INDEX IF EXISTS idx_bookings_availability_check;
DROP INDEX IF EXISTS idx_bookings_pending_payment_cleanup;
DROP INDEX IF EXISTS idx_bookings_plan_gin;
DROP INDEX IF EXISTS idx_bookings_addons_gin;
```

---

## Next Steps

1. ✅ **Review** the plan document
2. ✅ **Run** the migration
3. ✅ **Test** the functions with your data
4. ✅ **Set up** cleanup job
5. ✅ **Monitor** for conflicts
6. ⚠️ **Consider** enabling trigger (after testing)
7. 📝 **Document** for your team

---

## Questions?

- See `DUPLICATE_BOOKING_PREVENTION_PLAN.md` for detailed analysis
- See `AVAILABILITY_TABLES_EXPLANATION.md` for how availability tables work
- Check migration file comments for usage examples
