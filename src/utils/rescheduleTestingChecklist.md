
# Reschedule Flow Data Integration - Testing Checklist

This document provides a comprehensive guide to verifying the data integrity and logic of the rescheduling flow.

## 1. Data Sources & Expected Queries

- **Services Table (`services`)**: 
  - *Query*: `SELECT * FROM services ORDER BY base_price ASC`
  - *Expected*: Returns all active services with `base_price`, `daily_rate`, `weekly_rate`, `name`, and `description`.
  - *Console Log Check*: Look for `[Data Integration] Fetching all services...`

- **Availability & Bookings (`date_specific_availability`, `bookings`)**:
  - *Query 1*: `SELECT date FROM date_specific_availability WHERE service_id = X AND is_available = false`
  - *Query 2*: `SELECT drop_off_date, pickup_date FROM bookings WHERE plan->>id = X AND status NOT IN ('Cancelled', 'Returned')`
  - *Expected*: Combines both lists into a single array of blocked dates (YYYY-MM-DD format).
  - *Console Log Check*: Look for `[Data Integration] Found X blocked dates for service Y`

## 2. Pricing Calculations

- **Function**: `calculateBookingCost(service, startDate, endDate)`
- **Logic**: 
  - Duration = difference in days between start and end (min 1).
  - Total = `base_price` + `(weeks * weekly_rate)` + `(extra_days * daily_rate)`.
  - *Fallback*: If only `base_price` exists, Total = `base_price * duration`.
- **Test Case 1 (Same Service, Same Duration)**: New cost should equal old cost. Difference = $0.
- **Test Case 2 (Upgrade Service)**: New cost > Old cost. Difference should show as "Additional Charge".
- **Test Case 3 (Downgrade/Shorter Duration)**: New cost < Old cost. Difference should show as "Credit".

## 3. UI and State Verification

- **Step 1: Service Selection**:
  - [ ] Does it display all services pulled from the DB?
  - [ ] Are prices accurate based on the `services` table?
  - [ ] Does selecting a new service smoothly update without a page reload?
  - [ ] Is the current service clearly marked with a "CURRENT BOOKING" badge?

- **Step 2: Date & Time**:
  - [ ] Are original booking dates shown clearly at the top?
  - [ ] In the calendar, are unavailable/blocked dates grayed out and unselectable (strikethrough)?
  - [ ] Can you select a new start and end date?
  - [ ] Are the time dropdowns aligned side-by-side?

- **Step 3: Pricing Breakdown**:
  - [ ] Does it show "Original Booking Total"?
  - [ ] Does it show "New Service Cost"?
  - [ ] Is the "Service Difference" calculated correctly (New - Old)?

- **Step 4: Request Review**:
  - [ ] Does the comparison show accurate Original Dates vs New Dates?
  - [ ] Does it accurately reflect the selected times and service?
