# Field Usage Analysis: price_unit, service_type, homepage_price_unit

## Summary

This document analyzes the usage of three database fields from the `services` table to determine if they can be deprecated.

---

## 1. `price_unit` Field

### Database Definition
- **Type**: `TEXT` (nullable)
- **Location**: `services.price_unit`
- **Purpose**: Display unit for pricing (e.g., "/day", "/delivery & pickup")

### Usage Locations

#### ✅ **ACTIVELY USED** - Cannot Deprecate

1. **`src/components/Hero.jsx`** (Line 30, 77)
   - **Function**: Homepage hero section displays service cards
   - **Usage**: 
     ```javascript
     .select('name, base_price, price_unit, homepage_description')
     unit={service.price_unit}  // Displayed in ServiceCard component
     ```
   - **Display**: Shows price with unit: `$300/price_unit`
   - **Impact**: ⚠️ **CRITICAL** - Homepage display would break

2. **`src/components/PlanCard.jsx`** (Line 58, 101)
   - **Function**: Service plan cards on booking page
   - **Usage**:
     ```javascript
     const displayPriceUnit = plan.price_unit;
     <span className="text-gray-300 ml-2 text-sm">{displayPriceUnit}</span>
     ```
   - **Display**: Shows price with unit: `$150.00 /full day`
   - **Impact**: ⚠️ **CRITICAL** - Plan selection page would break

3. **`src/components/admin/PricingManager.jsx`** (Lines 15, 22, 40)
   - **Function**: Admin interface for managing service pricing
   - **Usage**:
     ```javascript
     const [unit, setUnit] = useState(service.price_unit || '/day');
     setUnit(service.price_unit || '/day');
     price_unit: unit  // Saved to database
     ```
   - **Display**: Editable input field for price unit
   - **Impact**: ⚠️ **CRITICAL** - Admin cannot manage pricing units

4. **`src/data/plans.js`** (Lines 6, 17, 30)
   - **Function**: Static plan data (fallback/legacy)
   - **Usage**: 
     ```javascript
     priceUnit: "/delivery & pickup",
     priceUnit: "/full day",
     priceUnit: "/delivery",
     ```
   - **Note**: This is static data, not from database
   - **Impact**: ⚠️ **MEDIUM** - Used as fallback if database data unavailable

### Current Database Values
Based on your data:
- Service 1: `"/delivery & pickup   "` (note trailing spaces)
- Service 2: `"/full day"`
- Service 3: `"/delivery"`
- Service 4: `null` (likely uses default)

### Recommendation: ❌ **DO NOT DEPRECATE**
- Used in 3+ critical UI components
- Required for proper price display
- Actively edited in admin interface

---

## 2. `service_type` Field

### Database Definition
- **Type**: `availability_time_type` (enum: likely 'window', 'hourly', 'material_delivery', 'daily_rental')
- **Location**: `services.service_type`
- **Purpose**: Determines booking behavior and time slot types

### Usage Locations

#### ✅ **ACTIVELY USED** - Cannot Deprecate

1. **`src/components/BookingForm.jsx`** (Lines 196, 217, 221, 226, 511, 514)
   - **Function**: Determines which time slots to show and date picker labels
   - **Usage**:
     ```javascript
     const serviceType = currentPlan.service_type;
     
     // Determines slot types
     if (serviceType === 'window' || serviceType === 'material_delivery') {
         return isStart ? (avail.deliverySlots || []) : (avail.pickupSlots || []);
     }
     if (serviceType === 'hourly') {
         return isStart ? (avail.hourlySlots || []) : (avail.returnSlots || []);
     }
     
     // Determines date picker labels
     currentPlan?.service_type === 'window' || currentPlan?.service_type === 'material_delivery' 
         ? "Delivery Date" : "Pickup Date"
     ```
   - **Impact**: ⚠️ **CRITICAL** - Booking form logic depends on this

2. **`src/components/PrintableReceipt.jsx`** (Lines 75-76)
   - **Function**: Determines receipt display format
   - **Usage**:
     ```javascript
     const isSelfServiceTrailer = currentPlan.service_type === 'hourly' && !isDelivery;
     const isWindowService = currentPlan.service_type === 'window' || 
                             currentPlan.service_type === 'material_delivery';
     ```
   - **Impact**: ⚠️ **CRITICAL** - Receipt formatting depends on this

3. **`src/components/admin/AvailabilityManager.jsx`** (Line 165)
   - **Function**: Admin availability management
   - **Usage**:
     ```javascript
     const serviceType = service.service_type;
     // Used to determine which time slot types to show
     ```
   - **Impact**: ⚠️ **CRITICAL** - Admin availability UI depends on this

4. **`src/components/admin/availability/ServiceAvailabilityCard.jsx`** (Lines 43, 73)
   - **Function**: Service availability card component
   - **Usage**:
     ```javascript
     time_type: service.service_type,  // Saved to service_availability
     serviceType={service.service_type}  // Passed to DayAvailability
     ```
   - **Impact**: ⚠️ **CRITICAL** - Availability configuration depends on this

5. **`src/components/admin/availability/DayAvailability.jsx`** (Line 6, 36, 125)
   - **Function**: Day availability configuration
   - **Usage**:
     ```javascript
     const TimeRangeSelector = ({ ..., serviceType }) => ...
     export const DayAvailability = ({ ..., serviceType, ... }) => {
         {serviceType === 'window' ? renderWindowSelectors() : renderHourlySelectors()}
     }
     ```
   - **Impact**: ⚠️ **CRITICAL** - Determines which time selectors to show

6. **Edge Functions** (`verify-address-and-distance`)
   - **Usage**: 
     ```typescript
     const { address, serviceType } = await req.json();
     // Used for address verification logic
     ```
   - **Impact**: ⚠️ **MEDIUM** - Address verification may depend on service type

### Service Type Values
Based on your data:
- Service 1: `'window'` - Uses delivery/pickup windows
- Service 2: `'hourly'` - Uses hourly pickup/return slots
- Service 3: `'window'` - Uses delivery windows
- Service 4: `'window'` - Uses delivery/pickup windows

### Recommendation: ❌ **DO NOT DEPRECATE**
- **Core business logic** depends on this field
- Determines booking flow, time slots, and UI behavior
- Used throughout admin interface
- Required for proper service configuration

---

## 3. `homepage_price_unit` Field

### Database Definition
- **Type**: `TEXT` (nullable)
- **Location**: `services.homepage_price_unit`
- **Purpose**: Special price unit for homepage display (different from regular price_unit)

### Usage Locations

#### ❌ **NOT ACTIVELY USED** - Can Deprecate

1. **Database Schema Only**
   - Field exists in schema and TypeScript types
   - **No actual usage found in codebase**

2. **`src/data/plans.js`** (Line 19)
   - **Function**: Static plan data (fallback/legacy)
   - **Usage**:
     ```javascript
     homepagePriceUnit: "/Same Day Rental",
     ```
   - **Note**: This is static data, not from database
   - **Impact**: ⚠️ **LOW** - Only used in static fallback data

### Current Database Values
Based on your data:
- Service 1: `null`
- Service 2: `null` (but static data has "/Same Day Rental")
- Service 3: `null`
- Service 4: `null`

### Analysis
- **Hero.jsx** uses `price_unit`, NOT `homepage_price_unit`
- **PlanCard.jsx** uses `price_unit`, NOT `homepage_price_unit`
- No components query or display `homepage_price_unit` from database
- Only exists in TypeScript types (auto-generated from schema)

### Recommendation: ✅ **CAN DEPRECATE**
- **Not used anywhere in application code**
- Only exists in database schema and TypeScript types
- Safe to remove after confirming no external dependencies

---

## Deprecation Plan

### Safe to Deprecate: `homepage_price_unit`

#### Step 1: Verify No External Dependencies
```sql
-- Check if any external systems query this field
-- Review API documentation
-- Check if any reports/queries use this field
```

#### Step 2: Remove from Code
1. Remove from database schema (migration)
2. TypeScript types will auto-update
3. No code changes needed (field not used)

#### Step 3: Migration Script
```sql
-- Migration: Remove homepage_price_unit
ALTER TABLE services DROP COLUMN IF EXISTS homepage_price_unit;
```

### Cannot Deprecate: `price_unit` and `service_type`

These fields are **critical** to application functionality:
- `price_unit`: Required for price display in UI
- `service_type`: Core business logic depends on this

---

## Summary Table

| Field | Used In | Critical? | Can Deprecate? |
|-------|---------|-----------|----------------|
| `price_unit` | Hero.jsx, PlanCard.jsx, PricingManager.jsx, plans.js | ✅ Yes | ❌ **NO** |
| `service_type` | BookingForm.jsx, PrintableReceipt.jsx, AvailabilityManager.jsx, DayAvailability.jsx, Edge Functions | ✅ Yes | ❌ **NO** |
| `homepage_price_unit` | None (only in schema/types) | ❌ No | ✅ **YES** |

---

## Recommendations

1. **Keep `price_unit`**: Essential for price display
2. **Keep `service_type`**: Core business logic dependency
3. **Remove `homepage_price_unit`**: Unused, safe to deprecate

### If You Want to Consolidate `price_unit` and `homepage_price_unit`:

Since `homepage_price_unit` is unused, you could:
- Keep using `price_unit` for all displays (current behavior)
- Remove `homepage_price_unit` entirely
- No code changes needed

---

## Files That Would Need Updates (if deprecating `homepage_price_unit`)

1. ✅ **None** - Field is not used in application code
2. Database migration script (remove column)
3. TypeScript types will auto-update from schema

---

## Testing Checklist (if deprecating `homepage_price_unit`)

- [ ] Verify Hero.jsx still displays prices correctly (uses `price_unit`)
- [ ] Verify PlanCard.jsx still displays prices correctly (uses `price_unit`)
- [ ] Verify PricingManager.jsx still works (uses `price_unit`)
- [ ] Check for any external API consumers
- [ ] Run database migration
- [ ] Verify TypeScript types update correctly
