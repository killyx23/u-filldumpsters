  select coalesce(auth.jwt() -> 'user_metadata' ->> 'is_admin', 'false')::boolean;
