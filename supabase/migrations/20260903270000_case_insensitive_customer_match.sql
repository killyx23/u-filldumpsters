-- handle_new_booking matched customers with `email = NEW.email`, which is
-- case-sensitive. A booking for Brandon@example.com and a later one for
-- brandon@example.com therefore produced two customer rows for one person,
-- splitting their history and breaking lookups that expect a single match.
--
-- Match case-insensitively (preferring the oldest row so history stays with the
-- original customer) and store new emails lowercased.

CREATE OR REPLACE FUNCTION public.handle_new_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
  address_verification_skipped_flag boolean;
  cleaned_phone text;
  incoming_status text;
  v_email_lc text;
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');
  incoming_status := lower(COALESCE(NEW.status, ''));
  v_email_lc := lower(trim(COALESCE(NEW.email, '')));

  SELECT id
    INTO customer_id_var
    FROM public.customers
   WHERE lower(trim(COALESCE(email, ''))) = v_email_lc
     AND v_email_lc <> ''
   ORDER BY id
   LIMIT 1;

  unverified_address_flag := COALESCE((NEW.addons->>'unverifiedAddress')::boolean, FALSE);
  verification_skipped_flag := COALESCE(
    (NEW.addons->>'verificationSkipped')::boolean,
    (NEW.addons->>'wasVerificationSkipped')::boolean,
    FALSE
  );
  address_verification_skipped_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);

  NEW.pending_address_verification := COALESCE((NEW.addons->>'pending_address_verification')::boolean, FALSE);
  IF NEW.pending_address_verification THEN
     NEW.unverified_address := NEW.addons->>'unverified_address';
     NEW.pending_verification_reason := NEW.addons->>'pending_verification_reason';
     NEW.pending_verification_date := now();
  END IF;

  IF customer_id_var IS NOT NULL THEN
    UPDATE public.customers
    SET
      name = COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name, customers.name),
      first_name = COALESCE(NEW.first_name, customers.first_name),
      last_name = COALESCE(NEW.last_name, customers.last_name),
      phone = COALESCE(cleaned_phone, customers.phone),
      street = COALESCE(NEW.street, customers.street),
      city = COALESCE(NEW.city, customers.city),
      state = COALESCE(NEW.state, customers.state),
      zip = COALESCE(NEW.zip, customers.zip),
      unverified_address = customers.unverified_address OR unverified_address_flag,
      has_incomplete_verification = customers.has_incomplete_verification OR verification_skipped_flag
    WHERE id = customer_id_var;
  ELSE
    INSERT INTO public.customers (
      name, first_name, last_name, email, phone, street, city, state, zip,
      unverified_address, has_incomplete_verification, segment
    )
    VALUES (
      COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name),
      NEW.first_name, NEW.last_name,
      NULLIF(v_email_lc, ''),
      cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip,
      unverified_address_flag, verification_skipped_flag, 'booked'
    )
    RETURNING id INTO customer_id_var;
  END IF;

  NEW.customer_id := customer_id_var;
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  NEW.name := COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name);

  -- Preserve booking_not_finished for promote-from-pending path; otherwise unpaid hold.
  IF incoming_status IS DISTINCT FROM 'booking_not_finished' THEN
    NEW.status := 'pending_payment';
  ELSE
    NEW.status := 'booking_not_finished';
  END IF;

  RETURN NEW;
END;
$function$;
