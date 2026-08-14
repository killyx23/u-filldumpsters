-- Concurrent checkout race: handle_new_booking() used to SELECT a customer by email, then
-- INSERT or UPDATE. Two simultaneous checkouts with the same email can both see "no row"
-- and the loser's INSERT dies on customers_email_key instead of the intended
-- booking_capacity_exceeded marker (or instead of succeeding).
--
-- Fix: INSERT ... ON CONFLICT (email) DO UPDATE. Preserves the
-- wasVerificationSkipped addon accepted by 20260521140000.

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
  verification_skipped_flag := coalesce(
    (new.addons->>'verificationSkipped')::boolean,
    (new.addons->>'wasVerificationSkipped')::boolean,
    false
  );
  address_verification_skipped_flag := coalesce((new.addons->>'addressVerificationSkipped')::boolean, false);

  new.pending_address_verification := coalesce((new.addons->>'pending_address_verification')::boolean, false);
  if new.pending_address_verification then
     new.unverified_address := new.addons->>'unverified_address';
     new.pending_verification_reason := new.addons->>'pending_verification_reason';
     new.pending_verification_date := now();
  end if;

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
  'BEFORE INSERT trigger on bookings. Upserts the customer row atomically instead of '
  'SELECT-then-branch, so concurrent checkouts sharing an email cannot race into a unique '
  'constraint violation. Accepts verificationSkipped or wasVerificationSkipped in addons.';
