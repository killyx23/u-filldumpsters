# RLS Policy Diagnosis - 406 Error & Query Failures

## Date: March 5, 2026
## Schema Version: 2026-03-05_13-55-53

---

## Issue 1: AdminDashboard.jsx - 406 Error

### Query
```javascript
supabase
  .from('bookings')
  .select('*, customers!inner(*)')
```

### Error
**HTTP 406** (Not Acceptable) - RLS policy violation

### Root Cause: ❌ **MISSING SELECT POLICY**

**Current RLS Policies for `bookings` table:**
```sql
-- Line 1611: RLS is ENABLED
ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;

-- Line 1614: INSERT policy exists
CREATE POLICY "bookings_insert_for_all" 
ON "public"."bookings" 
FOR INSERT TO "authenticated", "anon" 
WITH CHECK (true);

-- Line 1618: UPDATE policy exists
CREATE POLICY "bookings_update_all" 
ON "public"."bookings" 
FOR UPDATE 
USING (true) WITH CHECK (true);

-- ❌ NO SELECT POLICY EXISTS
```

**Problem**: 
- RLS is enabled on `bookings` table
- Only INSERT and UPDATE policies exist
- **No SELECT policy** = All SELECT queries are blocked
- This causes the 406 error when trying to read bookings

**Why 406?**
- Supabase returns 406 when RLS blocks a query
- The query `select('*, customers!inner(*)')` requires SELECT access to `bookings`
- Without a SELECT policy, RLS denies the query

---

## Issue 2: SupabaseAuthContext.jsx - Customers Query Failure

### Query
```javascript
supabase
  .from('customers')
  .select('id')
  .eq('user_id', currentUser.id)
  .single()
```

### Error
Unknown HTTP error (likely 406 or 403)

### Root Cause: ⚠️ **Policy May Be Too Restrictive or Join Issue**

**Current RLS Policies for `customers` table:**
```sql
-- Line 1631: RLS is ENABLED
ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

-- Line 1560: SELECT policy exists
CREATE POLICY "Customers can read own row" 
ON "public"."customers" 
FOR SELECT TO "authenticated" 
USING (true);

-- Line 1634: INSERT/UPDATE policy exists
CREATE POLICY "customers_public_insert_update" 
ON "public"."customers" 
USING (true) WITH CHECK (true);
```

**Analysis**:
- SELECT policy exists: `"Customers can read own row"` with `USING (true)`
- This should allow all authenticated users to read all customer rows
- **However**, the policy name suggests it's meant for "own row" but `USING (true)` allows all rows

**Potential Issues**:

1. **Policy Name vs Implementation Mismatch**:
   - Policy name: "Customers can read own row"
   - Policy condition: `USING (true)` (allows all rows)
   - This is confusing but should work

2. **Admin User May Not Have Customer Record**:
   - Query filters by `user_id = currentUser.id`
   - If admin user doesn't have a `customers` record, query returns no rows
   - This is expected behavior, not an error

3. **RLS Policy Evaluation**:
   - The policy `USING (true)` should allow the query
   - But if there's a conflict with other policies, it might fail

---

## Additional Issue: Foreign Key Join Problem

### The Join Query
```javascript
.select('*, customers!inner(*)')
```

**Problem**: This uses `!inner(*)` which requires:
1. SELECT access to `bookings` table ✅ (but blocked by missing policy)
2. SELECT access to `customers` table ✅ (policy exists)
3. Foreign key relationship between `bookings.customer_id` → `customers.id`

**If bookings SELECT policy is missing**, the entire join fails with 406.

---

## Summary of Issues

### Critical Issue #1: Missing Bookings SELECT Policy

| Table | RLS Enabled | INSERT Policy | UPDATE Policy | SELECT Policy | DELETE Policy |
|-------|------------|--------------|---------------|---------------|---------------|
| `bookings` | ✅ Yes | ✅ Yes | ✅ Yes | ❌ **MISSING** | ❌ Missing |

**Impact**: 
- AdminDashboard cannot fetch bookings → 406 error
- Any SELECT query on bookings table fails
- Joins with bookings fail

### Issue #2: Customers Query

**Possible Causes**:
1. Admin user doesn't have a customer record (expected, not an error)
2. Policy evaluation issue (less likely, policy allows all)
3. The query might be succeeding but returning empty result (not an error)

---

## Recommended Fixes

### Fix #1: Add Bookings SELECT Policy

**For Admin Users**:
```sql
CREATE POLICY "admin_bookings_select_all" 
ON "public"."bookings" 
FOR SELECT TO "authenticated" 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);
```

**For Customers** (if needed):
```sql
CREATE POLICY "customer_bookings_select_own" 
ON "public"."bookings" 
FOR SELECT TO "authenticated" 
USING (
  NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
  AND customer_id IN (
    SELECT id FROM public.customers
    WHERE user_id = auth.uid()
  )
);
```

### Fix #2: Verify Customers Query

The customers query should work with current policy, but:
- Check if admin user has a customer record
- If not, this is expected behavior (query succeeds, returns empty)
- If you want to skip this lookup for admins, add admin check in code

---

## Verification Steps

### Test Bookings SELECT
```sql
-- As admin user, try:
SELECT COUNT(*) FROM bookings;
-- Should fail with RLS error (no SELECT policy)

-- Check current policies:
SELECT * FROM pg_policies WHERE tablename = 'bookings';
-- Should show only INSERT and UPDATE policies
```

### Test Customers SELECT
```sql
-- As authenticated user, try:
SELECT * FROM customers WHERE user_id = auth.uid();
-- Should work (policy allows all with USING (true))

-- Check if admin has customer record:
SELECT * FROM customers WHERE user_id = '<admin_user_id>';
-- May return empty (expected if admin isn't a customer)
```

---

## Current Policy State (from schema_2026-03-05_13-55-53.sql)

### Bookings Table Policies
```sql
✅ bookings_insert_for_all (INSERT)
✅ bookings_update_all (UPDATE)
❌ NO SELECT POLICY
❌ NO DELETE POLICY
```

### Customers Table Policies
```sql
✅ "Customers can read own row" (SELECT) - USING (true)
✅ "Customers can update own row" (UPDATE) - WITH CHECK (user_id = auth.uid())
✅ customers_public_insert_update (INSERT/UPDATE) - USING (true) WITH CHECK (true)
```

---

## Conclusion

**Primary Issue**: Missing SELECT policy on `bookings` table is causing the 406 error.

**Secondary Issue**: Customers query should work, but may return empty if admin user doesn't have a customer record (this is expected, not an error).

**Action Required**: Add SELECT policy for bookings table to allow admin users to query bookings.
