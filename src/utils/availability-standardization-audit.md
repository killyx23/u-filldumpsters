
# Availability Standardization Audit & Data Flow Verification

This document outlines the standardisation of availability times per service type across the frontend and backend components.

## Database Changes
- Removed unused columns: `hourly_start_time`, `hourly_end_time` from `date_specific_availability` and `service_availability`.
- Ensured required columns exist: `delivery_start_time`, `delivery_end_time`, `delivery_pickup_start_time`, `delivery_pickup_end_time`, `pickup_start_time`, `pickup_end_time`, `return_start_time`, `return_end_time`.

## Service Column, Label, and Increment Mapping

### 1. 16 Yard Dumpster (Service ID: 1)
- **Supabase Columns:** `delivery_start_time`, `delivery_end_time`, `delivery_pickup_start_time`, `delivery_pickup_end_time`
- **Admin/Frontend Labels:** "Delivery Time", "Delivery Pickup"
- **Time Increments:** 2 hours
- **Read/Write Components:** `DayAvailability.jsx`, `AvailabilityManager.jsx`, `BookingForm.jsx`, `RescheduleDateTimeSelector.jsx`

### 2. Dump Loader Trailer Rental (Service ID: 2)
- **Supabase Columns:** `pickup_start_time`, `pickup_end_time`, `return_start_time`, `return_end_time`
- **Admin/Frontend Labels:** "Pickup Time", "Return Time"
- **Time Increments:** 1 hour
- **Read/Write Components:** `DayAvailability.jsx`, `AvailabilityManager.jsx`, `BookingForm.jsx`, `RescheduleDateTimeSelector.jsx`

### 3. Rock, Mulch, Gravel (Service ID: 3)
- **Supabase Columns:** `delivery_start_time`, `delivery_end_time`
- **Admin/Frontend Labels:** "Delivery Time"
- **Time Increments:** 2 hours
- **Read/Write Components:** `DayAvailability.jsx`, `AvailabilityManager.jsx`, `BookingForm.jsx`, `RescheduleDateTimeSelector.jsx`

### 4. Dump Loader Trailer with Delivery (Service ID: 4)
- **Supabase Columns:** `delivery_start_time`, `delivery_end_time`, `delivery_pickup_start_time`, `delivery_pickup_end_time`
- **Admin/Frontend Labels:** "Delivery Time", "Delivery Pickup"
- **Time Increments:** 2 hours
- **Read/Write Components:** `DayAvailability.jsx`, `AvailabilityManager.jsx`, `BookingForm.jsx`, `RescheduleDateTimeSelector.jsx`

## Files Modified & Changes Made
1. **Database:** Dropped obsolete hourly columns.
2. **`src/components/admin/availability/time-helpers.js`:** Added `getIncrementForService()` to centralize increment logic.
3. **`src/components/admin/availability/DayAvailability.jsx`:** Updated labels ("Delivery Time", "Delivery Pickup", "Pickup Time", "Return Time") and hooked into dynamic `getIncrementForService`.
4. **`src/components/BookingForm.jsx` & `AvailabilityManager.jsx` (Previous iterations):** Aligned form field maps to the standard.

## End-to-End Test Workflow
1. Admin logs into the system and navigates to Availability settings.
2. For "16 Yard Dumpster", admin sets "Delivery Time" to `08:00 - 10:00` and "Delivery Pickup" to `14:00 - 16:00`.
3. The payload is successfully persisted to Supabase without conflicts.
4. Customer visits the booking page, selects "16 Yard Dumpster". The time pickers correctly display 2-hour increments and standard labels.
5. "Delivery Pickup" selections load properly based on the admin config.
