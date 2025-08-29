
DECLARE
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
BEGIN
  -- Check if a customer with the given email already exists
  SELECT id INTO customer_id_var FROM public.customers WHERE email = NEW.email;

  -- Extract flags from the addons JSON
  unverified_address_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);
  verification_skipped_flag := COALESCE((NEW.addons->>'verificationSkipped')::boolean, FALSE);

  -- If customer doesn't exist, create a new one
  IF customer_id_var IS NULL THEN
    INSERT INTO public.customers (name, email, phone, street, city, state, zip, unverified_address, has_incomplete_verification)
    VALUES (NEW.name, NEW.email, NEW.phone, NEW.street, NEW.city, NEW.state, NEW.zip, unverified_address_flag, verification_skipped_flag)
    RETURNING id INTO customer_id_var;
  -- If customer exists, update their details, ensuring flags are sticky (once true, stays true)
  ELSE
    UPDATE public.customers
    SET 
      name = NEW.name,
      phone = NEW.phone,
      street = NEW.street,
      city = NEW.city,
      state = NEW.state,
      zip = NEW.zip,
      unverified_address = customers.unverified_address OR unverified_address_flag,
      has_incomplete_verification = customers.has_incomplete_verification OR verification_skipped_flag
    WHERE id = customer_id_var;
  END IF;

  -- Set the customer_id on the new booking record
  NEW.customer_id := customer_id_var;
  -- Also store the verification skip status directly on the booking for easier access
  NEW.was_verification_skipped := verification_skipped_flag;
  
  RETURN NEW;
END;
