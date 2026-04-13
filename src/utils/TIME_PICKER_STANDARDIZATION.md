
# Time Picker Standardization Guide

## Overview
This document outlines the centralization and standardization of time picker generation across the application. Previously, time slots were hardcoded natively in components. They are now dynamically generated via `useAvailableTimeSlots` based on the database configuration (`date_specific_availability`).

## Components Updated
1. `src/hooks/useAvailableTimeSlots.js` - New hook.
2. `src/components/TimePickerDropdown.jsx` - New component.
3. `src/utils/validateTimeAgainstAvailability.js` - New validation utility.
4. `src/components/BookingForm.jsx`
5. `src/components/customer-portal/BookingActionsDialogs.jsx`
6. `src/components/admin/BookingEditForm.jsx`
7. `src/index.css` - Scrolling styles added.

## API Usage

### `useAvailableTimeSlots(serviceId, date, timeType)`
- **`serviceId`**: The integer ID of the service (e.g., 1, 2, 3, 4).
- **`date`**: Date object or string (yyyy-MM-dd).
- **`timeType`**: String representing the column prefix to pull bounds from (`delivery`, `pickup`, `return`, `hourly`).
- **Returns**: `{ timeSlots: Array<{label, value}>, isLoading: boolean }`

### `TimePickerDropdown`
- Renders a visually unified Popover wrapping a ScrollArea.
- Receives the `timeSlots` payload from the hook.

## Verification Steps
1. Run the frontend.
2. Navigate to the main booking journey and select a service.
3. Select a date.
4. Open the "Time" dropdown. It should feature a custom scrollable viewport instead of a native Select dropdown and only show times strictly between the configured bounds for that service/date.
5. Log in as an admin, edit a booking, and observe the exact same time bounds are enforced for admins.
6. Log in as a customer, click "Reschedule", and ensure that the picker matches the bounds exactly.

## Troubleshooting
- If times say "No times available", verify the `service_id` and `date` in `date_specific_availability` have `is_available = true`.
- If the dropOffTimeType mapping feels incorrect, check the ID to type mapping used inside `BookingForm.jsx` and `BookingActionsDialogs.jsx` to ensure it targets `delivery`, `pickup`, or `return` accurately.
