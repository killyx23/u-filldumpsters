-- Phase 2f.6 concurrency testing (scripts/verify-concurrent-booking-capacity.mjs) surfaced a
-- pre-existing, unrelated race: handle_new_booking() looks up a customer by email, then
-- branches into INSERT or UPDATE based on what it found. Under true concurrency (two
-- checkouts landing at the same instant with the same email — the exact scenario Phase 1b's
-- write-time guard exists for), both transactions can pass the "customer doesn't exist" check
-- before either commits, and the loser's INSERT dies on customers_email_key with a raw
-- duplicate-key error instead of the intended booking_capacity_exceeded message (or, if
-- capacity was fine, instead of just succeeding).
--
-- Fix: collapse the check-then-act into one atomic INSERT ... ON CONFLICT (email) DO UPDATE.
-- The unique constraint itself is what serializes concurrent writers now, so there is no gap
-- between "does this email exist" and "create/update the row" for two transactions to fall
-- into. Same field-merge semantics as before, just atomic.

create or replace function public.handle_new_booking() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
  address_verification_skipped_flag boolean;
  cleaned_phone text;
begin
  cleaned_phone := regexp_replace(new.phone, '\D', '', 'g');

  unverified_address_flag := coalesce((new.addons->>'unverifiedAddress')::boolean, false);
  verification_skipped_flag := coalesce((new.addons->>'verificationSkipped')::boolean, false);
  address_verification_skipped_flag := coalesce((new.addons->>'addressVerificationSkipped')::boolean, false);

  new.pending_address_verification := coalesce((new.addons->>'pending_address_verification')::boolean, false);
  if new.pending_address_verification then
     new.unverified_address := new.addons->>'unverified_address';
     new.pending_verification_reason := new.addons->>'pending_verification_reason';
     new.pending_verification_date := now();
  end if;

  -- Atomic find-or-create/update. Postgres's ON CONFLICT resolution takes place under the
  -- constraint's own index lock, so two concurrent inserts for the same email can no longer
  -- both observe "no existing row" the way a separate SELECT-then-branch could.
  insert into public.customers (
    name, first_name, last_name, email, phone, street, city, state, zip,
    unverified_address, has_incomplete_verification
  )
  values (
    coalesce(new.first_name || ' ' || new.last_name, new.name),
    new.first_name, new.last_name, new.email, cleaned_phone, new.street, new.city, new.state, new.zip,
    unverified_address_flag, verification_skipped_flag
  )
  on conflict (email) do update set
    name = coalesce(excluded.name, public.customers.name),
    first_name = coalesce(excluded.first_name, public.customers.first_name),
    last_name = coalesce(excluded.last_name, public.customers.last_name),
    phone = coalesce(excluded.phone, public.customers.phone),
    street = coalesce(excluded.street, public.customers.street),
    city = coalesce(excluded.city, public.customers.city),
    state = coalesce(excluded.state, public.customers.state),
    zip = coalesce(excluded.zip, public.customers.zip),
    unverified_address = public.customers.unverified_address or excluded.unverified_address,
    has_incomplete_verification = public.customers.has_incomplete_verification or excluded.has_incomplete_verification
  returning id into customer_id_var;

  raise log '[handle_new_booking] customer upserted: customer_id=%, email=%', customer_id_var, new.email;

  new.customer_id := customer_id_var;
  new.was_verification_skipped := verification_skipped_flag or address_verification_skipped_flag;
  new.name := coalesce(new.first_name || ' ' || new.last_name, new.name);
  new.status := 'pending_payment';

  return new;
end;
$$;

comment on function public.handle_new_booking() is
  'BEFORE INSERT trigger on bookings. Upserts the customer row atomically (see migration '
  '20260730150000) instead of SELECT-then-branch, so concurrent checkouts sharing an email '
  'cannot race each other into a raw unique-constraint violation.';
