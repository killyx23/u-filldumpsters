# Customer Portal Login Changes

## Summary
Removed the email confirmation step from the customer portal login flow. Users now log in directly after entering their Customer ID and phone number.

## What Changed

### Before:
1. User enters Customer ID and Phone Number
2. System sends magic link to their email
3. User checks email and clicks link
4. User is logged into portal

### After:
1. User enters Customer ID and Phone Number
2. System validates credentials and logs them in immediately
3. User is redirected directly to portal (no email required)

## Files Modified

### 1. Frontend: `src/pages/CustomerLogin.jsx`
- **Removed**: Email confirmation screen ("Check Your Inbox!")
- **Removed**: `emailSent` state variable
- **Removed**: Unused `Mail` icon import
- **Updated**: Form submission now redirects directly to magic link URL
- **Updated**: Button text changed from "Get Login Link" to "Login to Portal"
- **Updated**: Loading text changed from "Sending..." to "Logging in..."
- **Updated**: Description text changed from "Enter your details to receive a secure link" to "Enter your credentials to access your portal"

### 2. Backend: `supabase/functions/customer-portal-login/index.ts`
- **Removed**: Email sending logic (Brevo API calls)
- **Removed**: HTML email template
- **Changed**: Function now returns the magic link URL directly in the response
- **Response format**: 
  ```json
  {
    "message": "Login successful.",
    "magicLink": "https://..."
  }
  ```

### 3. Backend: `supabase/functions/customer-portal-login/cors.ts`
- Created CORS headers file for the new active function

### 4. Backup: `supabase/backups/functions_2025-10-11_21-21-33/customer-portal-login/`
- Updated backup version with same changes

## How It Works Now

1. **User submits credentials** → Customer ID and Phone Number
2. **Backend validates** → Checks if customer exists with matching credentials
3. **Backend creates/gets auth user** → Ensures user exists in Supabase Auth
4. **Backend generates magic link** → Creates a one-time login URL
5. **Backend returns magic link** → Sends URL back to frontend
6. **Frontend redirects** → Navigates to magic link URL immediately
7. **Supabase Auth** → Establishes session via magic link
8. **User lands in portal** → Logged in automatically

## Security Notes

- Still uses two-factor verification (Customer ID + Phone Number)
- Magic links are still one-time use
- Magic links still expire (Supabase default settings)
- No reduction in security - just removed email middleman

## To Deploy

1. Deploy the updated function to Supabase:
   ```bash
   npx supabase functions deploy customer-portal-login
   ```

2. Test the login flow:
   - Navigate to `/login`
   - Enter valid Customer ID and Phone Number
   - Verify immediate redirect to portal

## Environment Variables Required

The function still uses these environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL` (for redirect after login)

**Note**: `BREVO_API_KEY` and `BREVO_FROM_EMAIL` are no longer used by this function but can remain in your environment.

## Rollback Instructions

If you need to rollback to the email-based flow:

1. Restore from backup:
   ```bash
   # Copy from an older backup, e.g., functions_2025-10-03_16-26-51
   cp -r supabase/backups/functions_2025-10-03_16-26-51/customer-portal-login/* supabase/functions/customer-portal-login/
   ```

2. Restore the old frontend:
   ```bash
   git checkout HEAD~1 src/pages/CustomerLogin.jsx
   ```

3. Redeploy:
   ```bash
   npx supabase functions deploy customer-portal-login
   ```

