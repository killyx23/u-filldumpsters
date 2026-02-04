# Availability Tables Explanation

## Overview

The `get-availability` function uses two tables to determine when services are available and what time slots can be booked. These tables work together in a **"default + override"** pattern.

---

## Table 1: `service_availability` (Weekly Recurring Rules)

### Purpose
Stores **recurring weekly schedules** for each service. This is your **default template** that applies every week.

### Key Fields
- `service_id`: Which service this rule applies to
- `day_of_week`: 0-6 (Sunday=0, Monday=1, ..., Saturday=6)
- `is_available`: Whether the service is available on this day of the week
- `delivery_start_time` / `delivery_end_time`: Time window for deliveries
- `pickup_start_time` / `pickup_end_time`: Time window for pickups
- `return_start_time` / `return_end_time`: Time window for returns
- `hourly_start_time` / `hourly_end_time`: Time window for hourly rentals

### Example Use Case
```sql
-- Service 2 (Dump Loader) is available Monday-Friday, 8 AM - 6 PM
INSERT INTO service_availability (service_id, day_of_week, is_available, 
                                   pickup_start_time, pickup_end_time)
VALUES 
  (2, 1, true, '08:00:00', '18:00:00'),  -- Monday
  (2, 2, true, '08:00:00', '18:00:00'),  -- Tuesday
  (2, 3, true, '08:00:00', '18:00:00'),  -- Wednesday
  (2, 4, true, '08:00:00', '18:00:00'),  -- Thursday
  (2, 5, true, '08:00:00', '18:00:00'); -- Friday
```

**This means**: Every Monday, Tuesday, Wednesday, Thursday, and Friday, Service 2 follows this schedule.

---

## Table 2: `date_specific_availability` (One-Off Overrides)

### Purpose
Stores **specific date overrides** that take precedence over weekly rules. Use this for holidays, special events, or temporary schedule changes.

### Key Fields
- `service_id`: Which service this override applies to
- `date`: The specific date (YYYY-MM-DD format)
- `is_available`: Whether the service is available on this specific date
- Same time fields as `service_availability`

### Example Use Cases
```sql
-- Close Service 2 on Christmas Day (Dec 25, 2026)
INSERT INTO date_specific_availability (service_id, date, is_available)
VALUES (2, '2026-12-25', false);

-- Extended hours on Black Friday (Nov 24, 2026)
INSERT INTO date_specific_availability (service_id, date, is_available,
                                        pickup_start_time, pickup_end_time)
VALUES (2, '2026-11-24', true, '06:00:00', '20:00:00');
```

**This means**: 
- On Dec 25, 2026: Service 2 is closed (regardless of what day of week it is)
- On Nov 24, 2026: Service 2 has extended hours (6 AM - 8 PM) instead of the normal 8 AM - 6 PM

---

## How `get-availability` Uses These Tables

### Step-by-Step Process

1. **Fetch Both Tables** (lines 55-57):
   ```typescript
   // Get all weekly rules for the service
   supabaseAdmin.from('service_availability')
     .select('*')
     .eq('service_id', serviceIdForAvail)
   
   // Get date-specific overrides for the date range
   supabaseAdmin.from('date_specific_availability')
     .select('*')
     .eq('service_id', serviceIdForAvail)
     .in('date', dateRange)
   ```

2. **Create Lookup Maps** (lines 71-78):
   ```typescript
   // Map: day_of_week → rule
   weeklyRulesMap = { 0: rule, 1: rule, ... }
   
   // Map: date → rule
   specificRulesMap = { '2026-02-15': rule, ... }
   ```

3. **For Each Date in Range** (lines 81-127):
   ```typescript
   for (const dateStr of dateRange) {
     const dayOfWeek = date.getDay(); // 0-6
     
     // PRIORITY: Check date-specific first, then fall back to weekly
     let rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
     
     // Determine availability
     let isAvailable = rule ? rule.is_available !== false : false;
     
     // Generate time slots from the rule's time windows
     const deliverySlots = generateSlotsFromRange(
       rule.delivery_start_time, 
       rule.delivery_end_time, 
       interval, 
       date, 
       now
     );
     // ... same for pickup, return, hourly slots
   }
   ```

### Priority Order (Line 84)
```
Date-Specific Rule → Weekly Rule → Default (unavailable)
```

**Logic**: 
- If a date-specific rule exists for that date → use it
- Otherwise, use the weekly rule for that day of week
- If neither exists → service is unavailable

---

## Real-World Example

### Scenario: Dump Loader Rental (Service ID 2)

**Weekly Schedule** (`service_availability`):
- Monday-Friday: Available 8 AM - 6 PM
- Saturday: Available 8 AM - 4 PM  
- Sunday: Closed

**Special Dates** (`date_specific_availability`):
- Dec 25, 2026 (Monday): Closed (Christmas)
- Nov 24, 2026 (Friday): Extended hours 6 AM - 8 PM (Black Friday)
- Dec 31, 2026 (Thursday): Early close at 2 PM (New Year's Eve)

### What Happens When Checking Availability:

| Date | Day of Week | Rule Used | Result |
|------|-------------|-----------|--------|
| Dec 23, 2026 | Friday | Weekly (Friday) | Available 8 AM - 6 PM |
| Dec 24, 2026 | Saturday | Weekly (Saturday) | Available 8 AM - 4 PM |
| Dec 25, 2026 | Monday | **Date-Specific** | **Closed** (overrides Monday rule) |
| Dec 26, 2026 | Tuesday | Weekly (Tuesday) | Available 8 AM - 6 PM |
| Nov 24, 2026 | Friday | **Date-Specific** | **Available 6 AM - 8 PM** (overrides Friday rule) |

---

## Why This Design?

### Benefits

1. **Efficiency**: Set up recurring schedules once, not for every date
2. **Flexibility**: Override specific dates without changing weekly rules
3. **Maintainability**: Easy to see what's "normal" vs. "special"
4. **Scalability**: Don't need to create rules for every single date

### Without Date-Specific Overrides
You'd have to manually update weekly rules before/after holidays, then change them back. This is error-prone and tedious.

### Without Weekly Rules
You'd have to create availability rules for every single date (365+ per year per service). This is impractical.

---

## Constraints & Validation

### `service_availability`
- **Unique constraint**: `(service_id, day_of_week)` - Can't have duplicate rules for same service/day
- **Check constraint**: `day_of_week >= 0 AND day_of_week <= 29` - Note: This allows 0-29, but typically only 0-6 (Sunday-Saturday) are used

### `date_specific_availability`
- **Unique constraint**: `(service_id, date)` - Can't have duplicate overrides for same service/date
- **Foreign key**: References `services(id)` - Ensures service exists

---

## Summary

- **`service_availability`**: "Every Monday, do this..."
- **`date_specific_availability`**: "But on THIS specific Monday, do that instead..."

The `get-availability` function checks date-specific first, then falls back to weekly rules, ensuring you can have both recurring schedules and one-off exceptions.
