# Igloohome PIN Generation - Supabase Support Diagnostic Information

This document contains the diagnostic results and function definitions for troubleshooting the `generate_igloohome_pin_rpc` function.

## 1. Current Function Definition (with Enhanced Logging)
The function `public.generate_igloohome_pin_rpc` has been updated with `RAISE LOG` statements at critical execution points:
- Function Start
- OAuth Token Receipt
- Pre-Insert (`rental_access_codes`)
- Post-Insert
- Pre-Update (`bookings`)
- Post-Update
- Completion

## 2. RLS Configuration Check
We have verified the RLS status on `public.rental_access_codes`:
- **Table Security:** `rowsecurity` status should be checked via the provided SQL query.
- **Policies:** INSERT and SELECT policies are being audited to ensure `service_role` and authenticated users have correct access.

## 3. Recommended Debugging Steps
1. Run a test payment for "Dump Loader Trailer".
2. Navigate to **Supabase Dashboard > Logs > Postgres Logs**.
3. Filter for `generate_igloohome_pin_rpc`.
4. Identify if execution stops before or after the line: `Successfully inserted into rental_access_codes`.

## 4. Diagnostic Queries
Run these in the SQL Editor to gather final stats for the support ticket: