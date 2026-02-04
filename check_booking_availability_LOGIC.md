# check_booking_availability() Logic Breakdown

## Function Signature

```sql
check_booking_availability(
  p_service_id INTEGER,           -- Service ID (1, 2, 3, or 4)
  p_drop_off_date DATE,            -- Start date of booking
  p_pickup_date DATE,              -- End date of booking
  p_drop_off_time_slot TEXT,       -- Optional: time slot (not currently used)
  p_pickup_time_slot TEXT,         -- Optional: time slot (not currently used)
  p_exclude_booking_id BIGINT,     -- Optional: exclude this booking ID (for updates)
  p_is_delivery BOOLEAN            -- true if Service 2 with delivery option
) RETURNS BOOLEAN                  -- true = available, false = conflict exists
```

---

## Step-by-Step Logic Flow

### Step 1: Service ID Mapping
```sql
IF p_service_id = 2 AND p_is_delivery THEN
  v_service_id_for_check := 4;  -- Service 2 with delivery → treat as Service 4
ELSE
  v_service_id_for_check := p_service_id;  -- Use service ID as-is
END IF;
```

**Why?** 
- Service 2 (Dump Loader) can be self-pickup OR delivery
- When delivery is selected, it should be treated as Service 4
- This ensures Service 2 (self) and Service 4 (delivery) don't conflict with each other

**Example:**
- Input: `p_service_id = 2, p_is_delivery = true`
- Result: `v_service_id_for_check = 4`

---

### Step 2: Date Range Overlap Check
```sql
(p_drop_off_date <= b.pickup_date AND p_pickup_date >= b.drop_off_date)
```

**Logic:** Two date ranges overlap if:
- Start of range 1 ≤ End of range 2 **AND**
- End of range 1 ≥ Start of range 2

**Visual Examples:**

```
✅ OVERLAP:
New:     [========]
Existing:  [========]
Result: OVERLAP

✅ OVERLAP:
New:       [========]
Existing: [========]
Result: OVERLAP

✅ OVERLAP:
New:     [==========]
Existing:  [====]
Result: OVERLAP (new contains existing)

❌ NO OVERLAP:
New:     [====]
Existing:        [====]
Result: NO OVERLAP

❌ NO OVERLAP:
New:           [====]
Existing: [====]
Result: NO OVERLAP
```

**Example:**
- New booking: Feb 10 - Feb 15
- Existing booking: Feb 12 - Feb 18
- Check: `Feb 10 <= Feb 18` ✅ AND `Feb 15 >= Feb 12` ✅
- Result: **OVERLAP** → Conflict exists

---

### Step 3: Service Matching Logic

The function checks if the booking's service matches the requested service:

```sql
(
  -- Case 1: Checking for Service 2 (self-pickup)
  (v_service_id_for_check = 2 AND 
   (b.plan->>'id')::INTEGER = 2 AND 
   COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = false)
  OR
  -- Case 2: Checking for Service 4 (with delivery)
  (v_service_id_for_check = 4 AND 
   (b.plan->>'id')::INTEGER = 2 AND 
   COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = true)
  OR
  -- Case 3: Other services (1, 3) - direct match
  (v_service_id_for_check NOT IN (2, 4) AND 
   (b.plan->>'id')::INTEGER = v_service_id_for_check)
)
```

**Why this complexity?**
- Service 2 and Service 4 both store `plan.id = 2` in the database
- They're differentiated by `addons.isDelivery`:
  - Service 2 (self): `plan.id = 2, addons.isDelivery = false`
  - Service 4 (delivery): `plan.id = 2, addons.isDelivery = true`

**Examples:**

| Checking For | Existing Booking | Match? | Reason |
|--------------|------------------|--------|--------|
| Service 1 | `plan.id = 1` | ✅ Yes | Direct match |
| Service 2 (self) | `plan.id = 2, isDelivery = false` | ✅ Yes | Service 2 self-pickup |
| Service 2 (self) | `plan.id = 2, isDelivery = true` | ❌ No | That's Service 4 |
| Service 4 (delivery) | `plan.id = 2, isDelivery = true` | ✅ Yes | Service 4 delivery |
| Service 4 (delivery) | `plan.id = 2, isDelivery = false` | ❌ No | That's Service 2 |
| Service 3 | `plan.id = 3` | ✅ Yes | Direct match |

---

### Step 4: Status Filter
```sql
b.status IN (
  'pending_payment',        -- ⚠️ KEY: Includes pending payments!
  'Confirmed',
  'Rescheduled',
  'Delivered',
  'waiting_to_be_returned',
  'pending_review'
)
```

**Why include `pending_payment`?**
- This is the **core fix** for duplicate bookings
- Bookings are created with `pending_payment` status BEFORE payment
- Without checking this, two users can book the same slot simultaneously

**Status Flow:**
```
Booking Created → 'pending_payment' → Payment → 'Confirmed'
                                      ↓
                              (or 'pending_verification'/'pending_review')
```

**Example:**
- User A creates booking → status: `pending_payment`
- User B checks availability → **MUST see User A's booking** → slot unavailable
- Without `pending_payment` check → User B sees slot as available → **DUPLICATE**

---

### Step 5: Exclude Current Booking (for Updates)
```sql
(p_exclude_booking_id IS NULL OR b.id != p_exclude_booking_id)
```

**Why?**
- When updating an existing booking, we need to exclude it from conflict check
- Otherwise, the booking would conflict with itself!

**Example:**
- Updating booking ID 123
- Pass `p_exclude_booking_id = 123`
- Function ignores booking 123 when checking for conflicts

---

### Step 6: Count Conflicts
```sql
SELECT COUNT(*) INTO v_conflicting_bookings
FROM bookings b
WHERE (
  -- All conditions above combined with AND
);
```

**Result:**
- `v_conflicting_bookings = 0` → No conflicts → Available ✅
- `v_conflicting_bookings > 0` → Conflicts exist → Not available ❌

---

### Step 7: Return Result
```sql
RETURN v_conflicting_bookings = 0;
```

**Returns:**
- `true` = Slot is available (no conflicts)
- `false` = Slot is NOT available (conflicts exist)

---

## Complete Example Walkthrough

### Scenario: Check if Service 1 (16 Yard Dumpster) is available Feb 10-15

```sql
SELECT check_booking_availability(
  p_service_id := 1,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15',
  p_is_delivery := false
);
```

**Step-by-Step Execution:**

1. **Service ID Mapping:**
   - `p_service_id = 1`, `p_is_delivery = false`
   - `v_service_id_for_check = 1` ✅

2. **Query Existing Bookings:**
   ```sql
   SELECT COUNT(*) 
   FROM bookings b
   WHERE (
     -- Date overlap: Feb 10 <= pickup_date AND Feb 15 >= drop_off_date
     ('2026-02-10' <= b.pickup_date AND '2026-02-15' >= b.drop_off_date)
     AND
     -- Service match: plan.id = 1
     ((b.plan->>'id')::INTEGER = 1)
     AND
     -- Active status
     b.status IN ('pending_payment', 'Confirmed', 'Rescheduled', 'Delivered', 'waiting_to_be_returned', 'pending_review')
   );
   ```

3. **Example Database State:**
   ```
   Booking ID | plan.id | drop_off_date | pickup_date | status
   -----------|---------|---------------|-------------|----------
   100        | 1       | 2026-02-08    | 2026-02-12  | Confirmed
   101        | 1       | 2026-02-16    | 2026-02-20  | Confirmed
   102        | 1       | 2026-02-13    | 2026-02-17  | pending_payment
   ```

4. **Check Each Booking:**
   - **Booking 100:** 
     - Date overlap? `Feb 10 <= Feb 12` ✅ AND `Feb 15 >= Feb 8` ✅ → **OVERLAP**
     - Service match? `plan.id = 1` ✅
     - Status active? `Confirmed` ✅
     - **CONFLICT FOUND** → Count = 1

   - **Booking 101:**
     - Date overlap? `Feb 10 <= Feb 20` ✅ BUT `Feb 15 >= Feb 16` ❌ → **NO OVERLAP**
     - Skip

   - **Booking 102:**
     - Date overlap? `Feb 10 <= Feb 17` ✅ AND `Feb 15 >= Feb 13` ✅ → **OVERLAP**
     - Service match? `plan.id = 1` ✅
     - Status active? `pending_payment` ✅
     - **CONFLICT FOUND** → Count = 2

5. **Result:**
   - `v_conflicting_bookings = 2`
   - `RETURN 2 = 0` → `false`
   - **Slot is NOT available** ❌

---

## Service 2/4 Special Case Example

### Scenario: Check Service 2 with delivery (should map to Service 4)

```sql
SELECT check_booking_availability(
  p_service_id := 2,
  p_drop_off_date := '2026-02-10',
  p_pickup_date := '2026-02-15',
  p_is_delivery := true  -- ⚠️ Delivery option selected
);
```

**Step-by-Step:**

1. **Service ID Mapping:**
   - `p_service_id = 2`, `p_is_delivery = true`
   - `v_service_id_for_check = 4` ✅ (mapped!)

2. **Query Logic:**
   ```sql
   WHERE (
     -- Date overlap check...
     AND
     -- Service match: Looking for Service 4 (delivery)
     (
       (v_service_id_for_check = 4 AND 
        (b.plan->>'id')::INTEGER = 2 AND 
        COALESCE((b.addons->>'isDelivery')::BOOLEAN, false) = true)
     )
   )
   ```

3. **What This Means:**
   - Only checks bookings where `plan.id = 2` AND `isDelivery = true`
   - Ignores Service 2 self-pickup bookings (`isDelivery = false`)
   - This ensures Service 2 (self) and Service 4 (delivery) don't conflict

---

## Key Takeaways

1. **Date Overlap Formula:** `start1 <= end2 AND end1 >= start2`

2. **Service 2/4 Mapping:** 
   - Service 2 with delivery → treated as Service 4
   - Checks `addons.isDelivery` to differentiate

3. **Includes `pending_payment`:** 
   - Critical for preventing duplicates
   - Catches bookings before payment completes

4. **Returns Boolean:**
   - `true` = Available (no conflicts)
   - `false` = Not available (conflicts exist)

5. **Exclude Option:**
   - Use `p_exclude_booking_id` when updating existing bookings

---

## Testing the Logic

```sql
-- Test 1: Available slot
SELECT check_booking_availability(1, '2026-03-01', '2026-03-05', NULL, NULL, NULL, false);
-- Expected: true (if no bookings exist)

-- Test 2: Conflicting slot
-- First, create a booking:
INSERT INTO bookings (name, email, phone, street, city, state, zip, 
                      drop_off_date, pickup_date, plan, addons, total_price, status)
VALUES ('Test', 'test@test.com', '1234567890', '123 St', 'City', 'ST', '12345',
        '2026-03-01', '2026-03-05', '{"id": 1}'::jsonb, '{}'::jsonb, 300, 'pending_payment');

-- Then check availability:
SELECT check_booking_availability(1, '2026-03-01', '2026-03-05', NULL, NULL, NULL, false);
-- Expected: false (conflict exists)

-- Test 3: Service 2/4 mapping
SELECT check_booking_availability(2, '2026-03-01', '2026-03-05', NULL, NULL, NULL, true);
-- This checks for Service 4 (delivery), not Service 2 (self-pickup)
```
