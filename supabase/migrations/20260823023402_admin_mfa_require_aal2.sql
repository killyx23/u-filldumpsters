-- Require authenticator MFA (JWT aal = aal2) in addition to app_metadata.is_admin.
-- Customer sessions remain AAL1 and are unaffected because is_admin is false for them.
-- Service-role Edge Functions continue to bypass RLS.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', 'false')::boolean
    AND coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
