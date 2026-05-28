# Admin account setup

## First admin (one-time)

The `create-admin` edge function requires an existing admin session. Bootstrap the **first** admin outside the app:

1. Supabase Dashboard → **Authentication** → **Users**
2. Select the user (or create one)
3. Edit **App Metadata** (raw JSON): `{ "is_admin": true }`
4. Save; user must sign out and back in for JWT to refresh

Alternatively use the service role from a trusted machine:

```bash
# Example: update via Admin API (replace USER_ID and keys)
curl -X PUT "https://<project-ref>.supabase.co/auth/v1/admin/users/<USER_ID>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"app_metadata":{"is_admin":true}}'
```

## Additional admins

Logged-in admins can invite others from **Admin Dashboard → Settings → Invite Admin**.

- Calls `create-admin` with the caller’s JWT
- Only creates **new** emails; rejects self, existing users, and non-admin callers
- Returns a one-time temporary password

## Deploy

```bash
supabase functions deploy create-admin
```

Remove the old public function from the hosted project:

```bash
supabase functions delete create-first-admin
```

Or delete **create-first-admin** in Supabase Dashboard → Edge Functions.

## Security notes

- Admin flag is read from `app_metadata.is_admin` only (not `user_metadata`)
- `public.is_admin()` RPC and RLS use the same JWT field
- Apply migration `20260526120000_is_admin_use_app_metadata.sql` if not already on the database
