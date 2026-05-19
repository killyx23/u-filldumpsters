drop policy "service_role_full_access" on "public"."tax_rate_cache";

revoke delete on table "public"."tax_rate_cache" from "anon";

revoke insert on table "public"."tax_rate_cache" from "anon";

revoke references on table "public"."tax_rate_cache" from "anon";

revoke select on table "public"."tax_rate_cache" from "anon";

revoke trigger on table "public"."tax_rate_cache" from "anon";

revoke truncate on table "public"."tax_rate_cache" from "anon";

revoke update on table "public"."tax_rate_cache" from "anon";

revoke delete on table "public"."tax_rate_cache" from "authenticated";

revoke insert on table "public"."tax_rate_cache" from "authenticated";

revoke references on table "public"."tax_rate_cache" from "authenticated";

revoke select on table "public"."tax_rate_cache" from "authenticated";

revoke trigger on table "public"."tax_rate_cache" from "authenticated";

revoke truncate on table "public"."tax_rate_cache" from "authenticated";

revoke update on table "public"."tax_rate_cache" from "authenticated";

revoke delete on table "public"."tax_rate_cache" from "service_role";

revoke insert on table "public"."tax_rate_cache" from "service_role";

revoke references on table "public"."tax_rate_cache" from "service_role";

revoke select on table "public"."tax_rate_cache" from "service_role";

revoke trigger on table "public"."tax_rate_cache" from "service_role";

revoke truncate on table "public"."tax_rate_cache" from "service_role";

revoke update on table "public"."tax_rate_cache" from "service_role";

alter table "public"."bookings" drop constraint "bookings_delivery_type_check";

alter table "public"."tax_records" drop constraint "tax_records_delivery_type_check";

alter table "public"."tax_rate_cache" drop constraint "tax_rate_cache_pkey";

drop index if exists "public"."tax_rate_cache_pkey";

drop table "public"."tax_rate_cache";

alter table "public"."bookings" drop column "delivery_type";

alter table "public"."bookings" drop column "tax_jurisdiction";

alter table "public"."bookings" drop column "tax_zip_used";

alter table "public"."business_settings" drop column "tax_rate_delivery";

alter table "public"."business_settings" drop column "tax_rate_pickup";

alter table "public"."equipment_pricing" drop column "is_taxable";

alter table "public"."pending_customers" drop column "subtotal_before_tax";

alter table "public"."services" drop column "delivery_fee_is_taxable";

alter table "public"."services" drop column "is_taxable";

alter table "public"."services" drop column "mileage_is_taxable";

alter table "public"."tax_records" drop column "delivery_type";

alter table "public"."tax_records" drop column "line_items";

alter table "public"."tax_records" drop column "non_taxable_subtotal";

alter table "public"."tax_records" drop column "tax_api_used";

alter table "public"."tax_records" drop column "tax_jurisdiction";

alter table "public"."tax_records" drop column "taxable_subtotal";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_booking_notes_to_customer_notes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- We only want to add notes on creation or specific updates, not every change.
  IF TG_OP = 'INSERT' THEN
    IF NEW.notes IS NOT NULL AND NEW.notes <> '' THEN
      INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (NEW.customer_id, NEW.id, 'Booking Special Instructions', NEW.notes);
    END IF;

    IF NEW.verification_notes IS NOT NULL AND NEW.verification_notes <> '' THEN
       INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (NEW.customer_id, NEW.id, 'Verification Skip Reason', NEW.verification_notes);
    END IF;
  
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if the booking was just cancelled with a refund
    IF OLD.status <> 'Cancelled' AND NEW.status = 'Cancelled' AND NEW.refund_details IS NOT NULL THEN
      INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (
        NEW.customer_id, 
        NEW.id, 
        'Booking Cancellation & Refund', 
        'Booking was cancelled. A refund of $' || (NEW.refund_details->>'amount')::numeric(10,2) || ' was processed. Reason: ' || (NEW.refund_details->>'reason')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_review_to_customer_notes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- When a new review is inserted, add a corresponding note.
  INSERT INTO public.customer_notes (customer_id, booking_id, source, content, author_type, is_read)
  VALUES (
    NEW.customer_id, 
    NEW.booking_id, 
    'Review Submission', 
    'We appreciate your feedback, it is very important to us. Thank you for your review!

Rating: ' || NEW.rating || '/5
Title: ' || COALESCE(NEW.title, 'N/A') || '
Review: "' || NEW.content || '"',
    'system',
    true -- Mark as read since it's a system notification
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_deleted_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- When a user is deleted from auth.users, this trigger will fire.
  -- We find the corresponding customer and delete them.
  DELETE FROM public.customers WHERE user_id = OLD.id;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_magic_tokens()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM magic_link_tokens
  WHERE expires_at < NOW() - INTERVAL '7 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_pending_customers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Delete unverified records older than 7 days
  DELETE FROM pending_customers
  WHERE is_verified = false
    AND created_at < NOW() - INTERVAL '7 days';
  
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$DECLARE
  new_id bigint;
  new_customer_id bigint;
BEGIN
  INSERT INTO bookings (
    name,
    first_name,
    last_name,
    email,
    phone,
    street,
    city,
    state,
    zip,
    contact_address,
    delivery_address,
    drop_off_date,
    pickup_date,
    drop_off_time_slot,
    pickup_time_slot,
    plan,
    addons,
    total_price,
    status,
    notes,
    was_verification_skipped,
    verification_notes
  )
  VALUES (
    payload->>'name',
    payload->>'first_name',
    payload->>'last_name',
    payload->>'email',
    payload->>'phone',
    payload->>'street',
    payload->>'city',
    payload->>'state',
    payload->>'zip',
    payload->'contact_address',
    payload->'delivery_address',
    (payload->>'drop_off_date')::date,
    (payload->>'pickup_date')::date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->'plan',
    payload->'addons',
    (payload->>'total_price')::real,
    'pending_payment',
    payload->>'notes',
    COALESCE((payload->>'was_verification_skipped')::boolean, false),
    payload->>'verification_notes'
  )
  RETURNING id, customer_id INTO new_id, new_customer_id;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id
  );
END;$function$
;

CREATE OR REPLACE FUNCTION public.current_customer_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT c.id
  FROM public.customers c
  WHERE c.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.decrement_equipment_quantities(items_to_decrement jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    DECLARE
        item_record jsonb;
        item_id bigint;
        qty_to_subtract int;
    BEGIN
        FOR item_record IN SELECT * FROM jsonb_array_elements(items_to_decrement)
        LOOP
            item_id := (item_record->>'equipment_id')::bigint;
            qty_to_subtract := (item_record->>'quantity')::int;

            UPDATE public.equipment
            SET total_quantity = total_quantity - qty_to_subtract
            WHERE id = item_id;
        END LOOP;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.generate_customer_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Generates a random 6-digit number and prepends 'CID-'
    NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    -- Check for uniqueness and regenerate if it exists (highly unlikely but good practice)
    WHILE EXISTS(SELECT 1 FROM public.customers WHERE customer_id_text = NEW.customer_id_text) LOOP
        NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    END LOOP;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_contact_form(contact_name text, contact_email text, contact_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    customer_id_var bigint;
BEGIN
    -- Check if a customer with the given email already exists
    SELECT id INTO customer_id_var FROM public.customers WHERE email = contact_email;

    -- If customer doesn't exist, create a new one
    IF customer_id_var IS NULL THEN
        INSERT INTO public.customers (name, email)
        VALUES (contact_name, contact_email)
        RETURNING id INTO customer_id_var;
    END IF;

    -- Insert the message as a note linked to the customer
    INSERT INTO public.customer_notes (customer_id, source, content)
    VALUES (customer_id_var, 'Contact Form Inquiry', contact_message);
END;
$function$
;

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
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');
  
  -- CRITICAL: Check if customer exists by email first
  SELECT id INTO customer_id_var FROM public.customers WHERE email = NEW.email;

  unverified_address_flag := COALESCE((NEW.addons->>'unverifiedAddress')::boolean, FALSE);
  verification_skipped_flag := COALESCE((NEW.addons->>'verificationSkipped')::boolean, FALSE);
  address_verification_skipped_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);

  NEW.pending_address_verification := COALESCE((NEW.addons->>'pending_address_verification')::boolean, FALSE);
  IF NEW.pending_address_verification THEN
     NEW.unverified_address := NEW.addons->>'unverified_address';
     NEW.pending_verification_reason := NEW.addons->>'pending_verification_reason';
     NEW.pending_verification_date := now();
  END IF;

  -- If customer exists, update their record with latest info
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
    
    -- Log returning customer booking
    RAISE LOG 'Returning customer booking: customer_id=%, email=%', customer_id_var, NEW.email;
  ELSE
    -- Create new customer record
    INSERT INTO public.customers (
      name, first_name, last_name, email, phone, street, city, state, zip, 
      unverified_address, has_incomplete_verification
    )
    VALUES (
      COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name), 
      NEW.first_name, NEW.last_name, NEW.email, cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip, 
      unverified_address_flag, verification_skipped_flag
    )
    RETURNING id INTO customer_id_var;
    
    RAISE LOG 'New customer created: customer_id=%, email=%', customer_id_var, NEW.email;
  END IF;

  -- Link booking to customer
  NEW.customer_id := customer_id_var;
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  NEW.name := COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name);
  NEW.status := 'pending_payment';
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.customers
    SET has_unread_notes = TRUE
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_equipment_quantities(items_to_increment jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    DECLARE
        item_record jsonb;
        item_id bigint;
        qty_to_add int;
    BEGIN
        FOR item_record IN SELECT * FROM jsonb_array_elements(items_to_increment)
        LOOP
            item_id := (item_record->>'equipment_id')::bigint;
            qty_to_add := (item_record->>'quantity')::int;

            UPDATE public.equipment
            SET total_quantity = total_quantity + qty_to_add
            WHERE id = item_id;
        END LOOP;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'is_admin', 'false')::boolean;
$function$
;

CREATE OR REPLACE FUNCTION public.log_financial_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.financial_audit_log (table_name, record_id, action, changes, user_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW)),
        auth.uid()
    );
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_verification_image_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Handle Front License Changes
    IF TG_OP = 'INSERT' AND NEW.license_front_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_front', NEW.license_front_storage_path, NEW.license_front_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.license_front_url IS DISTINCT FROM OLD.license_front_url AND NEW.license_front_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_front', NEW.license_front_storage_path, NEW.license_front_url, 'replaced', NEW.verified_by);
    END IF;

    -- Handle Back License Changes
    IF TG_OP = 'INSERT' AND NEW.license_back_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_back', NEW.license_back_storage_path, NEW.license_back_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.license_back_url IS DISTINCT FROM OLD.license_back_url AND NEW.license_back_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_back', NEW.license_back_storage_path, NEW.license_back_url, 'replaced', NEW.verified_by);
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.server_insert_booking(p_user_id uuid, p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id bigint;
  rec public.bookings;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_payload is null or p_payload = '{}'::jsonb then
    raise exception 'p_payload is required';
  end if;
  if p_payload ? 'id' then
    p_payload = p_payload - 'id';
  end if;
  if p_payload ? 'user_id' then
    p_payload = p_payload - 'user_id';
  end if;

  -- Populate a bookings record from JSON, then override user_id
  rec := (select * from jsonb_populate_record(null::public.bookings, p_payload));
  rec.user_id := p_user_id; -- Note: user_id doesn't exist; adjust to customer_id if needed

  -- Insert using explicit column list to avoid json-populate pitfalls
  insert into public.bookings(
    created_at, name, email, phone, street, city, state, zip,
    drop_off_date, pickup_date, plan, addons, total_price, status,
    delivered_at, picked_up_at, drop_off_time_slot, pickup_time_slot,
    notes, customer_id, rented_out_at, returned_at, equipment_status,
    return_issues, damage_photos, fees, verification_notes, refund_details,
    is_manually_verified, was_verification_skipped, assigned_inventory_items,
    reschedule_history
  ) values (
    rec.created_at, rec.name, rec.email, rec.phone, rec.street, rec.city, rec.state, rec.zip,
    rec.drop_off_date, rec.pickup_date, rec.plan, rec.addons, rec.total_price, rec.status,
    rec.delivered_at, rec.picked_up_at, rec.drop_off_time_slot, rec.pickup_time_slot,
    rec.notes, rec.customer_id, rec.rented_out_at, rec.returned_at, rec.equipment_status,
    rec.return_issues, rec.damage_photos, rec.fees, rec.verification_notes, rec.refund_details,
    rec.is_manually_verified, rec.was_verification_skipped, rec.assigned_inventory_items,
    rec.reschedule_history
  ) returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_customer_unread_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    has_unread boolean;
BEGIN
    -- This function is triggered when a note's is_read status is updated.
    -- We need to check if ANY notes for that customer are still unread.
    SELECT EXISTS (
        SELECT 1
        FROM public.customer_notes
        WHERE customer_id = COALESCE(NEW.customer_id, OLD.customer_id) AND is_read = FALSE
    ) INTO has_unread;

    -- Update the parent customer record.
    UPDATE public.customers
    SET has_unread_notes = has_unread
    WHERE id = COALESCE(NEW.customer_id, OLD.customer_id);

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_stripe_ids_to_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    customer_id_to_update BIGINT;
BEGIN
    -- Find the customer_id associated with the booking_id of the new payment info
    SELECT b.customer_id
    INTO customer_id_to_update
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;

    -- If a customer is found, update their record with the new Stripe IDs
    IF customer_id_to_update IS NOT NULL THEN
        UPDATE public.customers
        SET
            stripe_customer_id = COALESCE(NEW.stripe_customer_id, stripe_customer_id), -- Only update if new value is not null
            stripe_payment_intent_id = NEW.stripe_payment_intent_id, -- Always update to latest
            stripe_charge_id = NEW.stripe_charge_id -- Always update to latest
        WHERE
            id = customer_id_to_update;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_customer_unread_status_from_notes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    has_unread boolean;
BEGIN
    -- This function is triggered when a note's is_read status is updated.
    -- We need to check if ANY notes for that customer are still unread by the admin.
    SELECT EXISTS (
        SELECT 1
        FROM public.customer_notes
        WHERE customer_id = COALESCE(NEW.customer_id, OLD.customer_id) 
          AND is_read = FALSE 
          AND author_type = 'customer'
    ) INTO has_unread;

    -- Update the parent customer record.
    UPDATE public.customers
    SET has_unread_notes = has_unread
    WHERE id = COALESCE(NEW.customer_id, OLD.customer_id);

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_equipment_inventory_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_financial_categories_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_financial_expenses_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_financial_income_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_maintenance_schedule_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_service_availability_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_pending_customer(p_email text, p_first_name text, p_last_name text, p_phone text, p_street text, p_city text, p_state text, p_zip text, p_contact_address jsonb, p_delivery_address jsonb, p_drop_off_date date, p_pickup_date date, p_drop_off_time_slot text, p_pickup_time_slot text, p_notes text, p_service_id integer, p_plan_data jsonb, p_addons_data jsonb, p_booking_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_record_id UUID;
  v_is_verified BOOLEAN;
  v_email_lower TEXT;
BEGIN
  -- Normalize email to lowercase
  v_email_lower := LOWER(TRIM(p_email));
  
  -- Check if record exists
  SELECT id, is_verified INTO v_record_id, v_is_verified
  FROM pending_customers
  WHERE LOWER(email) = v_email_lower
  LIMIT 1;
  
  -- If record exists and is verified, raise error
  IF v_record_id IS NOT NULL AND v_is_verified = true THEN
    RAISE EXCEPTION 'Email already verified. Please use a different email or log in.'
      USING ERRCODE = 'unique_violation';
  END IF;
  
  -- If record exists and is not verified, update it
  IF v_record_id IS NOT NULL THEN
    UPDATE pending_customers
    SET
      first_name = p_first_name,
      last_name = p_last_name,
      name = TRIM(CONCAT(p_first_name, ' ', p_last_name)),
      phone = p_phone,
      street = p_street,
      city = p_city,
      state = p_state,
      zip = p_zip,
      contact_address = p_contact_address,
      delivery_address = p_delivery_address,
      drop_off_date = p_drop_off_date,
      pickup_date = p_pickup_date,
      drop_off_time_slot = p_drop_off_time_slot,
      pickup_time_slot = p_pickup_time_slot,
      notes = p_notes,
      service_id = p_service_id,
      plan_data = p_plan_data,
      addons_data = p_addons_data,
      booking_data = p_booking_data,
      created_at = NOW() -- Update timestamp
    WHERE id = v_record_id;
    
    RETURN v_record_id;
  END IF;
  
  -- No existing record, insert new one
  INSERT INTO pending_customers (
    email,
    first_name,
    last_name,
    name,
    phone,
    street,
    city,
    state,
    zip,
    contact_address,
    delivery_address,
    drop_off_date,
    pickup_date,
    drop_off_time_slot,
    pickup_time_slot,
    notes,
    service_id,
    plan_data,
    addons_data,
    booking_data,
    is_verified,
    created_at
  ) VALUES (
    v_email_lower,
    p_first_name,
    p_last_name,
    TRIM(CONCAT(p_first_name, ' ', p_last_name)),
    p_phone,
    p_street,
    p_city,
    p_state,
    p_zip,
    p_contact_address,
    p_delivery_address,
    p_drop_off_date,
    p_pickup_date,
    p_drop_off_time_slot,
    p_pickup_time_slot,
    p_notes,
    p_service_id,
    p_plan_data,
    p_addons_data,
    p_booking_data,
    false,
    NOW()
  ) RETURNING id INTO v_record_id;
  
  RETURN v_record_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_coupon(coupon_code text, service_id_arg integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    coupon_record RECORD;
BEGIN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE code = coupon_code AND is_active = TRUE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('isValid', false, 'error', 'Coupon not found or is inactive.');
    END IF;

    IF coupon_record.expires_at IS NOT NULL AND coupon_record.expires_at < NOW() THEN
        RETURN jsonb_build_object('isValid', false, 'error', 'This coupon has expired.');
    END IF;

    IF coupon_record.usage_limit IS NOT NULL AND coupon_record.usage_count >= coupon_record.usage_limit THEN
        RETURN jsonb_build_object('isValid', false, 'error', 'This coupon has reached its usage limit.');
    END IF;

    IF coupon_record.service_ids IS NOT NULL AND NOT (service_id_arg = ANY(coupon_record.service_ids)) THEN
        RETURN jsonb_build_object('isValid', false, 'error', 'This coupon is not valid for the selected service.');
    END IF;

    RETURN jsonb_build_object(
        'isValid', true,
        'id', coupon_record.id,
        'code', coupon_record.code,
        'discountType', coupon_record.discount_type,
        'discountValue', coupon_record.discount_value
    );
END;
$function$
;

drop policy "verification_documents_admin_all" on "storage"."objects";

drop policy "verification_documents_insert" on "storage"."objects";

drop policy "verification_documents_public_read" on "storage"."objects";

drop policy "verification_documents_update" on "storage"."objects";


  create policy "Allow authenticated deletes to verification-documents"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow authenticated updates to verification-documents"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow authenticated uploads to verification-documents"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow public read for verification-documents"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'verification-documents'::text));



  create policy "TEMP_DEBUG_ALLOW_ALL_STORAGE"
  on "storage"."objects"
  as permissive
  for all
  to public
using (true)
with check (true);




