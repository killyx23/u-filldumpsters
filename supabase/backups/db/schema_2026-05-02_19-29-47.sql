

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."availability_time_type" AS ENUM (
    'window',
    'hourly'
);


ALTER TYPE "public"."availability_time_type" OWNER TO "postgres";


CREATE TYPE "public"."service_occupancy_model" AS ENUM (
    'range',
    'dropoff_only',
    'dropoff_and_pickup_only',
    'same_day'
);


ALTER TYPE "public"."service_occupancy_model" OWNER TO "postgres";


CREATE TYPE "public"."service_time_type" AS ENUM (
    'window',
    'fullday',
    'hourly'
);


ALTER TYPE "public"."service_time_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_booking_notes_to_customer_notes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
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
$_$;


ALTER FUNCTION "public"."add_booking_notes_to_customer_notes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_review_to_customer_notes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."add_review_to_customer_notes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_booking_inventory_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_plan             jsonb;
  v_addons           jsonb;
  v_service_id       integer;
  v_is_delivery      boolean;
  v_occupancy        text;
  v_drop_off         date;
  v_pickup           date;
  v_rule             record;
  v_used             integer;
  v_plan_id_text     text;
BEGIN
  v_plan   := COALESCE(NEW.plan, '{}'::jsonb);
  v_addons := COALESCE(NEW.addons, '{}'::jsonb);

  v_plan_id_text := v_plan->>'id';
  IF v_plan_id_text IS NULL OR v_plan_id_text !~ '^\d+$' THEN
    RAISE LOG '[check_booking_inventory] plan.id is missing or non-numeric (%), allowing insert', v_plan_id_text;
    RETURN NEW;
  END IF;

  v_is_delivery := COALESCE(
    CASE
      WHEN v_addons->>'isDelivery' IN ('true', 'True', '1') THEN true
      WHEN v_addons->>'isDelivery' IN ('false', 'False', '0', '') THEN false
      WHEN jsonb_typeof(v_addons->'isDelivery') = 'boolean' THEN (v_addons->'isDelivery')::boolean
      ELSE false
    END,
    false
  );

  IF v_is_delivery AND v_plan_id_text::integer = 2 THEN
    v_service_id := 4;
  ELSE
    v_service_id := v_plan_id_text::integer;
  END IF;

  v_drop_off := NEW.drop_off_date;
  v_pickup   := NEW.pickup_date;

  SELECT COALESCE(s.occupancy_model::text, 'range')
    INTO v_occupancy
    FROM public.services s
   WHERE s.id = v_service_id;

  v_occupancy := COALESCE(v_occupancy, 'range');

  RAISE LOG '[check_booking_inventory] service_id=%, drop_off=%, pickup=%, occupancy=%, is_delivery=%',
    v_service_id, v_drop_off, v_pickup, v_occupancy, v_is_delivery;

  FOR v_rule IN
    SELECT ir.inventory_item_id,
           ir.quantity_required,
           ii.total_quantity,
           ii.name AS item_name
      FROM public.inventory_rules ir
      JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
     WHERE ir.service_id = v_service_id
  LOOP
    PERFORM 1
       FROM public.inventory_items
      WHERE id = v_rule.inventory_item_id
        FOR UPDATE;

    SELECT COALESCE(SUM(
      CASE
        WHEN ir2.quantity_required IS NOT NULL THEN ir2.quantity_required
        ELSE 0
      END
    ), 0)
    INTO v_used
    FROM public.bookings b
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN COALESCE(
            CASE
              WHEN jsonb_typeof(b.addons->'isDelivery') = 'boolean' THEN (b.addons->'isDelivery')::boolean
              WHEN b.addons->>'isDelivery' IN ('true', 'True', '1') THEN true
              ELSE false
            END,
            false
          ) AND (b.plan->>'id')::integer = 2
          THEN 4
          ELSE (b.plan->>'id')::integer
        END AS resolved_service_id
    ) bsvc
    LEFT JOIN public.inventory_rules ir2
      ON ir2.service_id = bsvc.resolved_service_id
     AND ir2.inventory_item_id = v_rule.inventory_item_id
    WHERE b.id IS DISTINCT FROM NEW.id
      AND bsvc.resolved_service_id IS NOT NULL
      AND b.status IN (
        'Confirmed', 'confirmed',
        'Rescheduled', 'rescheduled',
        'Delivered', 'delivered',
        'waiting_to_be_returned',
        'pending_review',
        'pending_payment',
        'pending',
        'flagged'
      )
      AND ir2.quantity_required IS NOT NULL
      AND (
        CASE COALESCE(
          (SELECT s2.occupancy_model::text FROM public.services s2 WHERE s2.id = bsvc.resolved_service_id),
          'range'
        )
          WHEN 'dropoff_only' THEN
            CASE v_occupancy
              WHEN 'dropoff_only' THEN b.drop_off_date = v_drop_off
              WHEN 'dropoff_and_pickup_only' THEN b.drop_off_date IN (v_drop_off, v_pickup)
              ELSE b.drop_off_date BETWEEN v_drop_off AND v_pickup
            END
          WHEN 'dropoff_and_pickup_only' THEN
            CASE v_occupancy
              WHEN 'dropoff_only' THEN v_drop_off IN (b.drop_off_date, b.pickup_date)
              WHEN 'dropoff_and_pickup_only' THEN
                b.drop_off_date IN (v_drop_off, v_pickup) OR b.pickup_date IN (v_drop_off, v_pickup)
              ELSE
                b.drop_off_date BETWEEN v_drop_off AND v_pickup
                OR b.pickup_date BETWEEN v_drop_off AND v_pickup
            END
          ELSE
            CASE v_occupancy
              WHEN 'dropoff_only' THEN v_drop_off BETWEEN b.drop_off_date AND b.pickup_date
              WHEN 'dropoff_and_pickup_only' THEN
                v_drop_off BETWEEN b.drop_off_date AND b.pickup_date
                OR v_pickup BETWEEN b.drop_off_date AND b.pickup_date
              ELSE
                b.drop_off_date <= v_pickup AND b.pickup_date >= v_drop_off
            END
        END
      );

    RAISE LOG '[check_booking_inventory] Item "%" (id=%): used=% / total=%, new booking needs=%',
      v_rule.item_name, v_rule.inventory_item_id, v_used, v_rule.total_quantity, v_rule.quantity_required;

    IF v_used + v_rule.quantity_required > v_rule.total_quantity THEN
      RAISE EXCEPTION 'Booking cannot be created: "%" is fully booked for these dates. % of % units in use.',
        v_rule.item_name,
        v_used,
        v_rule.total_quantity
      USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."check_booking_inventory_capacity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_deleted_users"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- When a user is deleted from auth.users, this trigger will fire.
  -- We find the corresponding customer and delete them.
  DELETE FROM public.customers WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_deleted_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_magic_tokens"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM magic_link_tokens
  WHERE expires_at < NOW() - INTERVAL '7 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_magic_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_pending_booking"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$DECLARE
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
END;$$;


ALTER FUNCTION "public"."create_pending_booking"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_customer_id"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_customer_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
    $$;


ALTER FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_customer_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Generates a random 6-digit number and prepends 'CID-'
    NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    -- Check for uniqueness and regenerate if it exists (highly unlikely but good practice)
    WHILE EXISTS(SELECT 1 FROM public.customers WHERE customer_id_text = NEW.customer_id_text) LOOP
        NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    END LOOP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_customer_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
  address_verification_skipped_flag boolean;
  cleaned_phone text;
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');
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

  IF customer_id_var IS NULL THEN
    INSERT INTO public.customers (
      name, first_name, last_name, email, phone, street, city, state, zip, unverified_address, has_incomplete_verification
    )
    VALUES (
      COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name), 
      NEW.first_name, NEW.last_name, NEW.email, cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip, 
      unverified_address_flag, verification_skipped_flag
    )
    RETURNING id INTO customer_id_var;
  ELSE
    UPDATE public.customers
    SET 
      name = COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name),
      first_name = COALESCE(NEW.first_name, customers.first_name),
      last_name = COALESCE(NEW.last_name, customers.last_name),
      phone = cleaned_phone, street = NEW.street, city = NEW.city, state = NEW.state, zip = NEW.zip,
      unverified_address = customers.unverified_address OR unverified_address_flag,
      has_incomplete_verification = customers.has_incomplete_verification OR verification_skipped_flag
    WHERE id = customer_id_var;
  END IF;

  NEW.customer_id := customer_id_var;
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  NEW.name := COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name);
  NEW.status := 'pending_payment';
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_note"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.customers
    SET has_unread_notes = TRUE
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_note"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_equipment_quantities"("items_to_increment" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
    $$;


ALTER FUNCTION "public"."increment_equipment_quantities"("items_to_increment" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'is_admin', 'false')::boolean;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_financial_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."log_financial_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_verification_image_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."log_verification_image_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_customer_unread_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."sync_customer_unread_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_stripe_ids_to_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."sync_stripe_ids_to_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ai_knowledge_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_ai_knowledge_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_unread_status_from_notes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."update_customer_unread_status_from_notes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_equipment_inventory_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_equipment_inventory_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_financial_categories_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_financial_categories_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_financial_expenses_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_financial_expenses_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_financial_income_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_financial_income_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_maintenance_schedule_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_maintenance_schedule_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_service_availability_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_service_availability_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_assistant_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "order_number" "text",
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "admin_notes" "text",
    "responded_at" timestamp with time zone
);


ALTER TABLE "public"."ai_assistant_messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_assistant_messages" IS 'Stores fallback messages from the AI Assistant when confidence is low or no answer is found';



CREATE TABLE IF NOT EXISTS "public"."ai_knowledge_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_knowledge_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_knowledge_sections" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_knowledge_sections" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ai_knowledge_sections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ai_knowledge_sections_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ai_knowledge_sections_id_seq" OWNED BY "public"."ai_knowledge_sections"."id";



CREATE TABLE IF NOT EXISTS "public"."booking_equipment" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "equipment_id" bigint NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "returned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booking_equipment" OWNER TO "postgres";


ALTER TABLE "public"."booking_equipment" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."booking_equipment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "street" "text" NOT NULL,
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip" "text" NOT NULL,
    "drop_off_date" "date" NOT NULL,
    "pickup_date" "date" NOT NULL,
    "plan" "jsonb" NOT NULL,
    "addons" "jsonb" NOT NULL,
    "total_price" real NOT NULL,
    "status" "text" DEFAULT 'pending_payment'::"text",
    "delivered_at" timestamp with time zone,
    "picked_up_at" timestamp with time zone,
    "drop_off_time_slot" "text",
    "pickup_time_slot" "text",
    "notes" "text",
    "customer_id" bigint,
    "rented_out_at" timestamp with time zone,
    "returned_at" timestamp with time zone,
    "equipment_status" "text" DEFAULT 'Pending'::"text",
    "return_issues" "jsonb",
    "damage_photos" "jsonb",
    "fees" "jsonb",
    "verification_notes" "text",
    "refund_details" "jsonb",
    "is_manually_verified" boolean DEFAULT false NOT NULL,
    "was_verification_skipped" boolean DEFAULT false,
    "assigned_inventory_items" "jsonb",
    "reschedule_history" "jsonb"[],
    "first_name" "text",
    "last_name" "text",
    "contact_address" "jsonb",
    "delivery_address" "jsonb",
    "payment_intent" "text",
    "client_secret" "text",
    "payment_method" "text",
    "pending_address_verification" boolean DEFAULT false,
    "unverified_address" "text",
    "pending_verification_date" timestamp with time zone,
    "pending_verification_reason" "text",
    "address_verified_by_admin" "text",
    "address_verified_date" timestamp with time zone,
    "reschedule_fee" numeric DEFAULT 0,
    "reschedule_timestamp" timestamp with time zone,
    "new_appointment_time" timestamp with time zone,
    "distance_miles" numeric DEFAULT 0 NOT NULL,
    "mileage_charge" numeric DEFAULT 0 NOT NULL,
    "tax_amount" numeric DEFAULT 0,
    "tax_rate_used" numeric DEFAULT 7.0,
    "subtotal_before_tax" numeric DEFAULT 0,
    "pin_generated_at" timestamp with time zone,
    "pin_notification_sent_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."bookings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bookings"."distance_miles" IS 'Total miles for complete 3-point route: Business → Customer → Landfill → Business';



COMMENT ON COLUMN "public"."bookings"."mileage_charge" IS 'Mileage fee calculated at booking time (distance_miles * rate)';



ALTER TABLE "public"."bookings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."bookings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."business_settings" (
    "id" integer NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "landfill_address" "text",
    "tax_rate" numeric DEFAULT 7.45,
    "tax_state" numeric DEFAULT 4.85,
    "tax_county" numeric DEFAULT 2.0,
    "tax_city" numeric DEFAULT 0.6,
    "tax_effective_date" "date" DEFAULT '2026-04-23'::"date"
);


ALTER TABLE "public"."business_settings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."business_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."business_settings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."business_settings_id_seq" OWNED BY "public"."business_settings"."id";



CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "text" NOT NULL,
    "customer_id" bigint NOT NULL,
    "booking_id" bigint,
    "sender_type" "text" NOT NULL,
    "sender_id" "text",
    "message_content" "text",
    "attachment_url" "text",
    "attachment_name" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chat_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['admin'::"text", 'customer'::"text"])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_messages" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."contact_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."contact_messages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."contact_messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."contact_messages_id_seq" OWNED BY "public"."contact_messages"."id";



CREATE TABLE IF NOT EXISTS "public"."coupons" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "code" "text" NOT NULL,
    "discount_type" "text" NOT NULL,
    "discount_value" numeric NOT NULL,
    "expires_at" timestamp with time zone,
    "usage_limit" integer,
    "usage_count" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "service_ids" integer[]
);


ALTER TABLE "public"."coupons" OWNER TO "postgres";


ALTER TABLE "public"."coupons" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."coupons_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."customer_notes" (
    "id" bigint NOT NULL,
    "customer_id" bigint NOT NULL,
    "booking_id" bigint,
    "source" "text" NOT NULL,
    "content" "text" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "author_id" "text",
    "author_type" "text",
    "thread_id" bigint,
    "parent_note_id" bigint,
    "attachment_url" "text",
    "attachment_name" "text"
);


ALTER TABLE "public"."customer_notes" OWNER TO "postgres";


ALTER TABLE "public"."customer_notes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."customer_notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "street" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "stripe_customer_id" "text",
    "notes" "text",
    "unverified_address" boolean DEFAULT false,
    "license_plate" "text",
    "has_unread_notes" boolean DEFAULT false NOT NULL,
    "license_image_urls" "jsonb",
    "has_incomplete_verification" boolean DEFAULT false,
    "admin_notes" "text",
    "customer_id_text" "text",
    "stripe_payment_intent_id" "text",
    "stripe_charge_id" "text",
    "user_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "distance_miles" numeric,
    "travel_time_minutes" integer
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."customers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."customers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."customers_id_seq" OWNED BY "public"."customers"."id";



CREATE TABLE IF NOT EXISTS "public"."date_specific_availability" (
    "id" integer NOT NULL,
    "service_id" integer NOT NULL,
    "date" "date" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "delivery_start_time" time without time zone,
    "delivery_end_time" time without time zone,
    "pickup_start_time" time without time zone,
    "return_by_time" time without time zone,
    "delivery_pickup_start_time" time without time zone,
    "delivery_pickup_end_time" time without time zone
);


ALTER TABLE "public"."date_specific_availability" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."date_specific_availability_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."date_specific_availability_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."date_specific_availability_id_seq" OWNED BY "public"."date_specific_availability"."id";



CREATE TABLE IF NOT EXISTS "public"."driver_verification_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" bigint,
    "license_front_url" "text",
    "license_back_url" "text",
    "license_front_storage_path" "text",
    "license_back_storage_path" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "verification_status" "text" DEFAULT 'pending'::"text",
    CONSTRAINT "driver_verification_documents_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."driver_verification_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dump_fees" (
    "id" integer NOT NULL,
    "service_id" integer,
    "fee_per_ton" numeric DEFAULT 0 NOT NULL,
    "max_tons" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "delivery_fee" numeric DEFAULT 0
);


ALTER TABLE "public"."dump_fees" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."dump_fees_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."dump_fees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."dump_fees_id_seq" OWNED BY "public"."dump_fees"."id";



CREATE TABLE IF NOT EXISTS "public"."email_verifications" (
    "email" "text" NOT NULL,
    "verification_code" "text" NOT NULL,
    "code_expires_at" timestamp with time zone NOT NULL,
    "is_verified" boolean DEFAULT false,
    "attempts" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "total_quantity" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocks_all_services_when_rented" boolean DEFAULT false,
    "type" "text",
    "service_id_association" integer,
    "description" "text",
    "price" numeric DEFAULT 0
);


ALTER TABLE "public"."equipment" OWNER TO "postgres";


ALTER TABLE "public"."equipment" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."equipment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."equipment_inventory" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "equipment_type" "text" NOT NULL,
    "purchase_date" "date" NOT NULL,
    "purchase_price" numeric(10,2) NOT NULL,
    "current_value" numeric(10,2) NOT NULL,
    "depreciation_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "condition" "text" NOT NULL,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "equipment_inventory_condition_check" CHECK (("condition" = ANY (ARRAY['Excellent'::"text", 'Good'::"text", 'Fair'::"text", 'Poor'::"text"]))),
    CONSTRAINT "equipment_inventory_current_value_check" CHECK (("current_value" >= (0)::numeric)),
    CONSTRAINT "equipment_inventory_depreciation_rate_check" CHECK ((("depreciation_rate" >= (0)::numeric) AND ("depreciation_rate" <= (100)::numeric))),
    CONSTRAINT "equipment_inventory_purchase_price_check" CHECK (("purchase_price" >= (0)::numeric)),
    CONSTRAINT "equipment_inventory_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Inactive'::"text", 'Sold'::"text", 'Retired'::"text"])))
);


ALTER TABLE "public"."equipment_inventory" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."equipment_inventory_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."equipment_inventory_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."equipment_inventory_id_seq" OWNED BY "public"."equipment_inventory"."id";



CREATE TABLE IF NOT EXISTS "public"."equipment_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "equipment_id" bigint NOT NULL,
    "item_type" "text" NOT NULL,
    "base_price" numeric(10,2) NOT NULL,
    "price_history" "jsonb" DEFAULT '[]'::"jsonb",
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "equipment_pricing_item_type_check" CHECK (("item_type" = ANY (ARRAY['rental_equipment'::"text", 'consumable_item'::"text", 'service_item'::"text"])))
);


ALTER TABLE "public"."equipment_pricing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."faqs" (
    "id" bigint NOT NULL,
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "position" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faqs" OWNER TO "postgres";


ALTER TABLE "public"."faqs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."faqs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."financial_audit_log" (
    "id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "changes" "jsonb",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."financial_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_audit_log_id_seq" OWNED BY "public"."financial_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."financial_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "category_type" "text" NOT NULL,
    "description" "text",
    "is_custom" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_categories_category_type_check" CHECK (("category_type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."financial_categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_categories_id_seq" OWNED BY "public"."financial_categories"."id";



CREATE TABLE IF NOT EXISTS "public"."financial_expenses" (
    "id" bigint NOT NULL,
    "equipment_id" bigint,
    "category_id" bigint,
    "amount" numeric(10,2) NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" "text",
    "vendor" "text",
    "mileage" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "financial_expenses_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."financial_expenses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_expenses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_expenses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_expenses_id_seq" OWNED BY "public"."financial_expenses"."id";



CREATE TABLE IF NOT EXISTS "public"."financial_income" (
    "id" bigint NOT NULL,
    "booking_id" bigint,
    "customer_id" bigint,
    "amount" numeric(10,2) NOT NULL,
    "income_type" "text" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "financial_income_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."financial_income" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_income_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_income_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_income_id_seq" OWNED BY "public"."financial_income"."id";



CREATE TABLE IF NOT EXISTS "public"."financial_projections" (
    "id" bigint NOT NULL,
    "projection_type" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "confidence_level" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_projections" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_projections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_projections_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_projections_id_seq" OWNED BY "public"."financial_projections"."id";



CREATE TABLE IF NOT EXISTS "public"."financial_reports" (
    "id" bigint NOT NULL,
    "report_type" "text" NOT NULL,
    "date_range_start" "date" NOT NULL,
    "date_range_end" "date" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."financial_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."financial_reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."financial_reports_id_seq" OWNED BY "public"."financial_reports"."id";



CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "total_quantity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."inventory_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."inventory_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."inventory_items_id_seq" OWNED BY "public"."inventory_items"."id";



CREATE TABLE IF NOT EXISTS "public"."inventory_rules" (
    "id" integer NOT NULL,
    "service_id" integer NOT NULL,
    "inventory_item_id" integer NOT NULL,
    "quantity_required" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."inventory_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."inventory_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."inventory_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."inventory_rules_id_seq" OWNED BY "public"."inventory_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."magic_link_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "customer_id" bigint NOT NULL,
    "phone" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."magic_link_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_schedule" (
    "id" bigint NOT NULL,
    "equipment_id" bigint NOT NULL,
    "category_id" bigint NOT NULL,
    "frequency" "text",
    "next_due_date" "date",
    "last_service_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "maintenance_schedule_frequency_check" CHECK (("frequency" = ANY (ARRAY['Weekly'::"text", 'Monthly'::"text", 'Quarterly'::"text", 'Annually'::"text", 'One-time'::"text"])))
);


ALTER TABLE "public"."maintenance_schedule" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."maintenance_schedule_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."maintenance_schedule_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."maintenance_schedule_id_seq" OWNED BY "public"."maintenance_schedule"."id";



CREATE TABLE IF NOT EXISTS "public"."rental_access_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" bigint NOT NULL,
    "customer_email" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "access_pin" "text" DEFAULT '0'::"text" NOT NULL,
    "pin_id" "text" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "pin_type" "text" DEFAULT 'bridge_proxied'::"text" NOT NULL,
    "lock_id" "text" DEFAULT ''::"text" NOT NULL,
    "notified_at" timestamp with time zone,
    CONSTRAINT "rental_access_codes_pin_type_check" CHECK (("pin_type" = ANY (ARRAY['algopin'::"text", 'bridge_proxied'::"text"]))),
    CONSTRAINT "rental_access_codes_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'used'::"text"])))
);


ALTER TABLE "public"."rental_access_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rental_tracking_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" bigint NOT NULL,
    "event_type" "text" NOT NULL,
    "event_timestamp" timestamp with time zone NOT NULL,
    "api_sync_timestamp" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    CONSTRAINT "rental_tracking_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['unlock'::"text", 'lock'::"text", 'pin_generated'::"text", 'admin_override'::"text", 'sync_error'::"text"])))
);


ALTER TABLE "public"."rental_tracking_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reschedule_history_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" bigint,
    "original_appointment_time" timestamp with time zone,
    "reschedule_request_time" timestamp with time zone,
    "new_appointment_time" timestamp with time zone,
    "fee_applied" boolean,
    "fee_amount" numeric,
    "original_total" numeric,
    "new_total" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "approval_timestamp" timestamp with time zone,
    "admin_id" "uuid",
    "original_service_id" integer,
    "new_service_id" integer,
    "refund_amount" numeric,
    "transaction_id" "text",
    "cancellation_reason" "text",
    "request_status" "text" DEFAULT 'pending'::"text",
    "request_type" "text" DEFAULT 'reschedule'::"text",
    "new_drop_off_date" "date",
    "new_pickup_date" "date",
    "new_drop_off_time" "text",
    "new_pickup_time" "text",
    "original_drop_off_date" "date",
    "original_pickup_date" "date",
    "original_drop_off_time" "text",
    "original_pickup_time" "text"
);


ALTER TABLE "public"."reschedule_history_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_access_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "customer_id" "text",
    "accessed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."resource_access_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "cover_image_url" "text",
    "file_url" "text",
    "pdf_url" "text",
    "qr_code_data" "text",
    "qr_code_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."resources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_id" bigint NOT NULL,
    "customer_id" bigint NOT NULL,
    "rating" integer NOT NULL,
    "title" "text",
    "content" "text" NOT NULL,
    "is_public" boolean DEFAULT false NOT NULL,
    "image_urls" "jsonb",
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


ALTER TABLE "public"."reviews" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."service_availability" (
    "id" bigint NOT NULL,
    "service_id" integer NOT NULL,
    "day_of_week" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "time_type" "public"."service_time_type",
    "delivery_window_start_time" time without time zone,
    "delivery_window_end_time" time without time zone,
    "pickup_start_time" time without time zone,
    "pickup_end_time" time without time zone,
    "return_by_time" time without time zone,
    "return_end_time" time without time zone,
    "is_available" boolean DEFAULT true NOT NULL,
    "delivery_pickup_window_start_time" time without time zone,
    "delivery_pickup_window_end_time" time without time zone,
    CONSTRAINT "service_availability_day_of_month_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 29)))
);


ALTER TABLE "public"."service_availability" OWNER TO "postgres";


ALTER TABLE "public"."service_availability" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."service_availability_id_seq1"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."service_reminders" (
    "id" bigint NOT NULL,
    "reminder_type" "text" NOT NULL,
    "equipment_id" bigint,
    "due_date" "date" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_reminders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."service_reminders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."service_reminders_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."service_reminders_id_seq" OWNED BY "public"."service_reminders"."id";



CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "base_price" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "price_unit" "text",
    "sale_price" numeric(10,2),
    "homepage_description" "text",
    "weekly_rate" numeric,
    "daily_rate" numeric,
    "service_type" "public"."availability_time_type",
    "homepage_price" numeric,
    "homepage_price_unit" "text",
    "features" "jsonb",
    "occupancy_model" "public"."service_occupancy_model" DEFAULT 'range'::"public"."service_occupancy_model" NOT NULL,
    "mileage_rate" numeric DEFAULT 0.85,
    "delivery_fee" numeric DEFAULT 0
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_payment_info" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "stripe_customer_id" "text",
    "stripe_payment_intent_id" "text",
    "stripe_charge_id" "text",
    "stripe_checkout_session_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_payment_info" OWNER TO "postgres";


ALTER TABLE "public"."stripe_payment_info" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stripe_payment_info_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tax_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" bigint NOT NULL,
    "tax_amount" numeric NOT NULL,
    "tax_rate" numeric NOT NULL,
    "subtotal_before_tax" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tax_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."tax_records" IS 'Audit trail for all tax collections from bookings';



COMMENT ON COLUMN "public"."tax_records"."tax_amount" IS 'Actual tax amount charged in dollars';



COMMENT ON COLUMN "public"."tax_records"."tax_rate" IS 'Tax rate percentage used at time of booking (e.g., 7.45 for 7.45%)';



COMMENT ON COLUMN "public"."tax_records"."subtotal_before_tax" IS 'Subtotal before tax was applied';



CREATE TABLE IF NOT EXISTS "public"."typing_indicators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "text" NOT NULL,
    "admin_is_typing" boolean DEFAULT false,
    "customer_is_typing" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."typing_indicators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verification_image_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" bigint,
    "document_id" "uuid",
    "image_type" "text" NOT NULL,
    "storage_path" "text",
    "url" "text",
    "action" "text" NOT NULL,
    "notes" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."verification_image_history" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_knowledge_sections" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_knowledge_sections_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."business_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."business_settings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."contact_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."contact_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."customers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."customers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."date_specific_availability" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."date_specific_availability_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."dump_fees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dump_fees_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."equipment_inventory" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."equipment_inventory_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_expenses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_expenses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_income" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_income_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_projections" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_projections_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."financial_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."financial_reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inventory_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inventory_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."maintenance_schedule" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."maintenance_schedule_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."service_reminders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."service_reminders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_knowledge_base"
    ADD CONSTRAINT "ai_knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_knowledge_sections"
    ADD CONSTRAINT "ai_knowledge_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_settings"
    ADD CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_settings"
    ADD CONSTRAINT "business_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_notes"
    ADD CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_date_service_id_key" UNIQUE ("date", "service_id");



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_service_id_date_key" UNIQUE ("service_id", "date");



ALTER TABLE ONLY "public"."driver_verification_documents"
    ADD CONSTRAINT "driver_verification_documents_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."driver_verification_documents"
    ADD CONSTRAINT "driver_verification_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dump_fees"
    ADD CONSTRAINT "dump_fees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dump_fees"
    ADD CONSTRAINT "dump_fees_service_id_key" UNIQUE ("service_id");



ALTER TABLE ONLY "public"."email_verifications"
    ADD CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."equipment_inventory"
    ADD CONSTRAINT "equipment_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_pricing"
    ADD CONSTRAINT "equipment_pricing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_audit_log"
    ADD CONSTRAINT "financial_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_categories"
    ADD CONSTRAINT "financial_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."financial_categories"
    ADD CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_expenses"
    ADD CONSTRAINT "financial_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_income"
    ADD CONSTRAINT "financial_income_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_projections"
    ADD CONSTRAINT "financial_projections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_reports"
    ADD CONSTRAINT "financial_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_access_codes"
    ADD CONSTRAINT "rental_access_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_tracking_logs"
    ADD CONSTRAINT "rental_tracking_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reschedule_history_logs"
    ADD CONSTRAINT "reschedule_history_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resource_access_logs"
    ADD CONSTRAINT "resource_access_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_pkey1" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_service_id_day_of_week_key" UNIQUE ("service_id", "day_of_week");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_day_unique" UNIQUE ("service_id", "day_of_week");



ALTER TABLE ONLY "public"."service_reminders"
    ADD CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."typing_indicators"
    ADD CONSTRAINT "typing_indicators_conversation_id_key" UNIQUE ("conversation_id");



ALTER TABLE ONLY "public"."typing_indicators"
    ADD CONSTRAINT "typing_indicators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "unique_booking_review" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."equipment_pricing"
    ADD CONSTRAINT "uq_equipment_pricing_equipment_id" UNIQUE ("equipment_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_pkey" PRIMARY KEY ("id");



CREATE INDEX "customers_user_id_idx" ON "public"."customers" USING "btree" ("user_id");



CREATE INDEX "idx_ai_assistant_messages_created_at" ON "public"."ai_assistant_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ai_assistant_messages_customer_id" ON "public"."ai_assistant_messages" USING "btree" ("customer_id");



CREATE INDEX "idx_ai_assistant_messages_status" ON "public"."ai_assistant_messages" USING "btree" ("status");



CREATE INDEX "idx_ai_knowledge_base_content" ON "public"."ai_knowledge_base" USING "gin" ("to_tsvector"('"english"'::"regconfig", "content"));



CREATE INDEX "idx_ai_knowledge_base_section_id" ON "public"."ai_knowledge_base" USING "btree" ("section_id");



CREATE INDEX "idx_ai_knowledge_base_title" ON "public"."ai_knowledge_base" USING "gin" ("to_tsvector"('"english"'::"regconfig", "title"));



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_distance_miles" ON "public"."bookings" USING "btree" ("distance_miles");



CREATE INDEX "idx_chat_messages_conversation_id" ON "public"."chat_messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_chat_messages_created_at" ON "public"."chat_messages" USING "btree" ("created_at");



CREATE INDEX "idx_chat_messages_customer_id" ON "public"."chat_messages" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_booking_id" ON "public"."customer_notes" USING "btree" ("booking_id");



CREATE INDEX "idx_customer_notes_customer_id" ON "public"."customer_notes" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_parent_note_id" ON "public"."customer_notes" USING "btree" ("parent_note_id");



CREATE INDEX "idx_customer_notes_thread_id" ON "public"."customer_notes" USING "btree" ("thread_id");



CREATE INDEX "idx_customers_user_id" ON "public"."customers" USING "btree" ("id");



CREATE INDEX "idx_equipment_inventory_status" ON "public"."equipment_inventory" USING "btree" ("status");



CREATE INDEX "idx_equipment_inventory_type" ON "public"."equipment_inventory" USING "btree" ("equipment_type");



CREATE INDEX "idx_equipment_pricing_created_at" ON "public"."equipment_pricing" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_equipment_pricing_equipment_id" ON "public"."equipment_pricing" USING "btree" ("equipment_id");



CREATE INDEX "idx_equipment_pricing_item_type" ON "public"."equipment_pricing" USING "btree" ("item_type");



CREATE INDEX "idx_financial_audit_log_created_at" ON "public"."financial_audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_financial_audit_log_table" ON "public"."financial_audit_log" USING "btree" ("table_name");



CREATE INDEX "idx_financial_categories_name" ON "public"."financial_categories" USING "btree" ("name");



CREATE INDEX "idx_financial_categories_type" ON "public"."financial_categories" USING "btree" ("category_type");



CREATE INDEX "idx_financial_expenses_category_id" ON "public"."financial_expenses" USING "btree" ("category_id");



CREATE INDEX "idx_financial_expenses_date" ON "public"."financial_expenses" USING "btree" ("date");



CREATE INDEX "idx_financial_expenses_equipment_id" ON "public"."financial_expenses" USING "btree" ("equipment_id");



CREATE INDEX "idx_financial_income_booking_id" ON "public"."financial_income" USING "btree" ("booking_id");



CREATE INDEX "idx_financial_income_customer_id" ON "public"."financial_income" USING "btree" ("customer_id");



CREATE INDEX "idx_financial_income_date" ON "public"."financial_income" USING "btree" ("date");



CREATE INDEX "idx_financial_projections_type" ON "public"."financial_projections" USING "btree" ("projection_type");



CREATE INDEX "idx_financial_reports_date_range" ON "public"."financial_reports" USING "btree" ("date_range_start", "date_range_end");



CREATE INDEX "idx_financial_reports_type" ON "public"."financial_reports" USING "btree" ("report_type");



CREATE INDEX "idx_magic_link_tokens_customer" ON "public"."magic_link_tokens" USING "btree" ("customer_id");



CREATE INDEX "idx_magic_link_tokens_expires" ON "public"."magic_link_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_magic_link_tokens_token" ON "public"."magic_link_tokens" USING "btree" ("token");



CREATE INDEX "idx_maintenance_schedule_equipment_id" ON "public"."maintenance_schedule" USING "btree" ("equipment_id");



CREATE INDEX "idx_maintenance_schedule_next_due" ON "public"."maintenance_schedule" USING "btree" ("next_due_date");



CREATE INDEX "idx_rental_access_codes_order_id" ON "public"."rental_access_codes" USING "btree" ("order_id");



CREATE INDEX "idx_rental_access_codes_status" ON "public"."rental_access_codes" USING "btree" ("status");



CREATE INDEX "idx_rental_tracking_logs_event_timestamp" ON "public"."rental_tracking_logs" USING "btree" ("event_timestamp" DESC);



CREATE INDEX "idx_rental_tracking_logs_event_type" ON "public"."rental_tracking_logs" USING "btree" ("event_type");



CREATE INDEX "idx_rental_tracking_logs_order_id" ON "public"."rental_tracking_logs" USING "btree" ("order_id");



CREATE INDEX "idx_reviews_booking_id" ON "public"."reviews" USING "btree" ("booking_id");



CREATE INDEX "idx_service_reminders_due_date" ON "public"."service_reminders" USING "btree" ("due_date");



CREATE INDEX "idx_service_reminders_equipment" ON "public"."service_reminders" USING "btree" ("equipment_id");



CREATE INDEX "idx_service_reminders_status" ON "public"."service_reminders" USING "btree" ("status");



CREATE INDEX "idx_stripe_payment_info_booking_id" ON "public"."stripe_payment_info" USING "btree" ("booking_id");



CREATE INDEX "idx_tax_records_booking_id" ON "public"."tax_records" USING "btree" ("booking_id");



CREATE INDEX "idx_tax_records_created_at" ON "public"."tax_records" USING "btree" ("created_at");



CREATE INDEX "idx_user_roles_user_role" ON "public"."user_roles" USING "btree" ("user_id", "role");



CREATE OR REPLACE TRIGGER "ai_knowledge_base_updated_at" BEFORE UPDATE ON "public"."ai_knowledge_base" FOR EACH ROW EXECUTE FUNCTION "public"."update_ai_knowledge_updated_at"();



CREATE OR REPLACE TRIGGER "ai_knowledge_sections_updated_at" BEFORE UPDATE ON "public"."ai_knowledge_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_ai_knowledge_updated_at"();



CREATE OR REPLACE TRIGGER "before_customer_insert_generate_id" BEFORE INSERT ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."generate_customer_id"();



CREATE OR REPLACE TRIGGER "equipment_inventory_updated_at" BEFORE UPDATE ON "public"."equipment_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."update_equipment_inventory_updated_at"();



CREATE OR REPLACE TRIGGER "financial_categories_updated_at" BEFORE UPDATE ON "public"."financial_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_categories_updated_at"();



CREATE OR REPLACE TRIGGER "financial_expenses_updated_at" BEFORE UPDATE ON "public"."financial_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_expenses_updated_at"();



CREATE OR REPLACE TRIGGER "financial_income_updated_at" BEFORE UPDATE ON "public"."financial_income" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_income_updated_at"();



CREATE OR REPLACE TRIGGER "financial_projections_updated_at" BEFORE UPDATE ON "public"."financial_projections" FOR EACH ROW EXECUTE FUNCTION "public"."update_maintenance_schedule_updated_at"();



CREATE OR REPLACE TRIGGER "log_equipment_inventory_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."equipment_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_changes"();



CREATE OR REPLACE TRIGGER "log_financial_expenses_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."financial_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_changes"();



CREATE OR REPLACE TRIGGER "log_financial_income_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."financial_income" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_changes"();



CREATE OR REPLACE TRIGGER "log_maintenance_schedule_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."maintenance_schedule" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_changes"();



CREATE OR REPLACE TRIGGER "maintenance_schedule_updated_at" BEFORE UPDATE ON "public"."maintenance_schedule" FOR EACH ROW EXECUTE FUNCTION "public"."update_maintenance_schedule_updated_at"();



CREATE OR REPLACE TRIGGER "on_booking_insert" BEFORE INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_booking"();



CREATE OR REPLACE TRIGGER "on_booking_insert_or_update_create_note" AFTER INSERT OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."add_booking_notes_to_customer_notes"();



CREATE OR REPLACE TRIGGER "on_new_note" AFTER INSERT ON "public"."customer_notes" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_note"();



CREATE OR REPLACE TRIGGER "on_note_read_status_change" AFTER UPDATE ON "public"."customer_notes" FOR EACH ROW WHEN (("old"."is_read" IS DISTINCT FROM "new"."is_read")) EXECUTE FUNCTION "public"."update_customer_unread_status_from_notes"();



CREATE OR REPLACE TRIGGER "on_payment_info_insert_sync_customer" AFTER INSERT OR UPDATE ON "public"."stripe_payment_info" FOR EACH ROW EXECUTE FUNCTION "public"."sync_stripe_ids_to_customer"();



CREATE OR REPLACE TRIGGER "on_review_insert_create_note" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."add_review_to_customer_notes"();



CREATE OR REPLACE TRIGGER "on_service_availability_update" BEFORE UPDATE ON "public"."service_availability" FOR EACH ROW EXECUTE FUNCTION "public"."update_service_availability_updated_at"();



CREATE OR REPLACE TRIGGER "on_verification_document_change" AFTER INSERT OR UPDATE ON "public"."driver_verification_documents" FOR EACH ROW EXECUTE FUNCTION "public"."log_verification_image_changes"();



CREATE OR REPLACE TRIGGER "service_reminders_updated_at" BEFORE UPDATE ON "public"."service_reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_maintenance_schedule_updated_at"();



CREATE OR REPLACE TRIGGER "trg_check_booking_inventory" BEFORE INSERT OR UPDATE OF "drop_off_date", "pickup_date", "plan", "addons", "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."check_booking_inventory_capacity"();

ALTER TABLE "public"."bookings" DISABLE TRIGGER "trg_check_booking_inventory";



ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_knowledge_base"
    ADD CONSTRAINT "ai_knowledge_base_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."ai_knowledge_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_notes"
    ADD CONSTRAINT "customer_notes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_notes"
    ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_notes"
    ADD CONSTRAINT "customer_notes_parent_note_id_fkey" FOREIGN KEY ("parent_note_id") REFERENCES "public"."customer_notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_notes"
    ADD CONSTRAINT "customer_notes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."customer_notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."driver_verification_documents"
    ADD CONSTRAINT "driver_verification_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_verification_documents"
    ADD CONSTRAINT "driver_verification_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dump_fees"
    ADD CONSTRAINT "dump_fees_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_service_id_association_fkey" FOREIGN KEY ("service_id_association") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."financial_audit_log"
    ADD CONSTRAINT "financial_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_expenses"
    ADD CONSTRAINT "financial_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_expenses"
    ADD CONSTRAINT "financial_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_expenses"
    ADD CONSTRAINT "financial_expenses_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_inventory"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_income"
    ADD CONSTRAINT "financial_income_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_income"
    ADD CONSTRAINT "financial_income_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_income"
    ADD CONSTRAINT "financial_income_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_reports"
    ADD CONSTRAINT "financial_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "fk_booking" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "fk_customer" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_pricing"
    ADD CONSTRAINT "fk_equipment_pricing_equipment" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_pricing"
    ADD CONSTRAINT "fk_equipment_pricing_updated_by" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id");



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_inventory"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_access_codes"
    ADD CONSTRAINT "rental_access_codes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_tracking_logs"
    ADD CONSTRAINT "rental_tracking_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reschedule_history_logs"
    ADD CONSTRAINT "reschedule_history_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_access_logs"
    ADD CONSTRAINT "resource_access_logs_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_reminders"
    ADD CONSTRAINT "service_reminders_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_inventory"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."driver_verification_documents"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access to date_specific_availability" ON "public"."date_specific_availability" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to equipment_inventory" ON "public"."equipment_inventory" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to equipment_pricing" ON "public"."equipment_pricing" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to financial_audit_log" ON "public"."financial_audit_log" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_categories" ON "public"."financial_categories" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_expenses" ON "public"."financial_expenses" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_income" ON "public"."financial_income" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_projections" ON "public"."financial_projections" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to financial_reports" ON "public"."financial_reports" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to maintenance_schedule" ON "public"."maintenance_schedule" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to rental_access_codes" ON "public"."rental_access_codes" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to rental_tracking_logs" ON "public"."rental_tracking_logs" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to service_reminders" ON "public"."service_reminders" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to tax_records" ON "public"."tax_records" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write access on resources" ON "public"."resources" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin write access to ai_knowledge_base" ON "public"."ai_knowledge_base" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write access to ai_knowledge_sections" ON "public"."ai_knowledge_sections" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write business_settings" ON "public"."business_settings" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admins can manage all reviews" ON "public"."reviews" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Admins can read all AI assistant messages" ON "public"."ai_assistant_messages" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can update AI assistant messages" ON "public"."ai_assistant_messages" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins via roles table" ON "public"."stripe_payment_info" TO "authenticated" USING ((("auth"."role"() = 'service_role'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = 'admin'::"text")))))) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = 'admin'::"text"))))));



CREATE POLICY "Allow admin full access" ON "public"."equipment" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow admin full access" ON "public"."faqs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow admin full access to dump_fees" ON "public"."dump_fees" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Allow admin full access to verification history" ON "public"."verification_image_history" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Allow admins full access to chat_messages" ON "public"."chat_messages" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Allow admins full access to typing indicators" ON "public"."typing_indicators" USING (true) WITH CHECK (true);



CREATE POLICY "Allow admins to select chat_messages" ON "public"."chat_messages" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Allow all for Admin Dashboard" ON "public"."service_availability" USING (("auth"."role"() = 'Admin Dashboard'::"text")) WITH CHECK (("auth"."role"() = 'Admin Dashboard'::"text"));



CREATE POLICY "Allow all for admin" ON "public"."coupons" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for admin" ON "public"."service_availability" USING (("auth"."role"() = 'admin'::"text")) WITH CHECK (("auth"."role"() = 'admin'::"text"));



CREATE POLICY "Allow all for admins" ON "public"."inventory_items" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow all for admins" ON "public"."inventory_rules" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow authenticated users to update services" ON "public"."services" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow customers access to typing indicators" ON "public"."typing_indicators" USING (true) WITH CHECK (true);



CREATE POLICY "Allow customers to insert their own messages" ON "public"."chat_messages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers"
  WHERE (("customers"."id" = "chat_messages"."customer_id") AND ("customers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Allow customers to read their own messages" ON "public"."chat_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."customers"
  WHERE (("customers"."id" = "chat_messages"."customer_id") AND ("customers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Allow customers to update read status of their messages" ON "public"."chat_messages" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."customers"
  WHERE (("customers"."id" = "chat_messages"."customer_id") AND ("customers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Allow customers to view their own verification history" ON "public"."verification_image_history" FOR SELECT USING (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))));



CREATE POLICY "Allow public read access" ON "public"."faqs" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to all" ON "public"."service_availability" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to dump_fees" ON "public"."dump_fees" FOR SELECT USING (true);



CREATE POLICY "Allow public read and controlled updates" ON "public"."equipment" USING (true);



CREATE POLICY "Allow service role full access" ON "public"."email_verifications" USING (true);



CREATE POLICY "Block public delete to equipment_pricing" ON "public"."equipment_pricing" FOR DELETE USING (false);



CREATE POLICY "Block public insert to equipment_pricing" ON "public"."equipment_pricing" FOR INSERT WITH CHECK (false);



CREATE POLICY "Block public read access" ON "public"."stripe_payment_info" FOR SELECT USING (false);



CREATE POLICY "Block public update to equipment_pricing" ON "public"."equipment_pricing" FOR UPDATE USING (false);



CREATE POLICY "Customers can create reviews for their own bookings" ON "public"."reviews" FOR INSERT WITH CHECK (((( SELECT "bookings"."customer_id"
   FROM "public"."bookings"
  WHERE ("bookings"."id" = "reviews"."booking_id")) = ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))) AND (( SELECT "bookings"."status"
   FROM "public"."bookings"
  WHERE ("bookings"."id" = "reviews"."booking_id")) = 'Completed'::"text")));



CREATE POLICY "Customers can insert their own AI assistant messages" ON "public"."ai_assistant_messages" FOR INSERT TO "authenticated" WITH CHECK (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))));



CREATE POLICY "Customers can manage own verification docs" ON "public"."driver_verification_documents" USING ((("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))) OR "public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Customers can read own row" ON "public"."customers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Customers can read their own AI assistant messages" ON "public"."ai_assistant_messages" FOR SELECT TO "authenticated" USING ((("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))) OR "public"."is_admin"()));



CREATE POLICY "Customers can read their own access codes (by booking ownership" ON "public"."rental_access_codes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."customers" "c" ON (("c"."id" = "b"."customer_id")))
  WHERE (("b"."id" = "rental_access_codes"."order_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "Customers can read their own tracking logs" ON "public"."rental_tracking_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "rental_tracking_logs"."order_id") AND ("bookings"."email" = ("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "Customers can update own row" ON "public"."customers" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Public can read approved reviews" ON "public"."reviews" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Public can validate magic link tokens" ON "public"."magic_link_tokens" FOR SELECT USING ((("expires_at" > "now"()) AND ("used_at" IS NULL)));



CREATE POLICY "Public read access on resources" ON "public"."resources" FOR SELECT USING (true);



CREATE POLICY "Public read access to ai_knowledge_base" ON "public"."ai_knowledge_base" FOR SELECT USING (true);



CREATE POLICY "Public read access to ai_knowledge_sections" ON "public"."ai_knowledge_sections" FOR SELECT USING (true);



CREATE POLICY "Public read access to date_specific_availability" ON "public"."date_specific_availability" FOR SELECT USING (true);



CREATE POLICY "Public read access to equipment_pricing" ON "public"."equipment_pricing" FOR SELECT USING (true);



CREATE POLICY "Public read access to services" ON "public"."services" FOR SELECT USING (true);



CREATE POLICY "Public read business_settings" ON "public"."business_settings" FOR SELECT USING (true);



CREATE POLICY "Public read equipment_inventory" ON "public"."equipment_inventory" FOR SELECT USING (true);



CREATE POLICY "Public read financial_categories" ON "public"."financial_categories" FOR SELECT USING (true);



CREATE POLICY "Public read tax_records" ON "public"."tax_records" FOR SELECT USING (true);



CREATE POLICY "Service role full access on magic_link_tokens" ON "public"."magic_link_tokens" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to services" ON "public"."services" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."booking_equipment" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."contact_messages" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."customer_notes" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."reviews" USING (true) WITH CHECK (true);



ALTER TABLE "public"."ai_assistant_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_knowledge_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon_can_insert_customer_notes" ON "public"."customer_notes" FOR INSERT TO "anon" WITH CHECK (true);



ALTER TABLE "public"."booking_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings_admin_all_write" ON "public"."bookings" FOR INSERT WITH CHECK (true);



CREATE POLICY "bookings_admin_delete" ON "public"."bookings" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "bookings_admin_update" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bookings_insert_for_all" ON "public"."bookings" FOR INSERT WITH CHECK (true);



CREATE POLICY "bookings_public_read" ON "public"."bookings" FOR SELECT USING (true);



CREATE POLICY "bookings_select_admin" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "bookings_update_all" ON "public"."bookings" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."business_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_public_insert_update" ON "public"."customers" USING (true) WITH CHECK (true);



CREATE POLICY "customers_select_admin" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."date_specific_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_verification_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dump_fees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_pricing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."faqs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faqs_public_delete" ON "public"."faqs" FOR DELETE USING (true);



CREATE POLICY "faqs_public_insert" ON "public"."faqs" FOR INSERT WITH CHECK (true);



CREATE POLICY "faqs_public_select" ON "public"."faqs" FOR SELECT USING (true);



CREATE POLICY "faqs_public_update" ON "public"."faqs" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."financial_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_income" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_projections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magic_link_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_schedule" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_all_authenticated" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."rental_access_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rental_access_codes_insert_for_booking_email" ON "public"."rental_access_codes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "rental_access_codes"."order_id") AND ("b"."email" = "rental_access_codes"."customer_email")))));



CREATE POLICY "rental_access_codes_service_role_update" ON "public"."rental_access_codes" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."rental_tracking_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reschedule_history_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resource_access_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_payment_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."typing_indicators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verification_image_history" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."customer_notes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."typing_indicators";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "booking_creator";











































































































































































GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_magic_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_magic_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_magic_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_customer_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_customer_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_note"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_note"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_note"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "postgres";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "anon";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "postgres";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "anon";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "postgres";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "anon";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_equipment_quantities"("items_to_increment" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_equipment_quantities"("items_to_increment" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_equipment_quantities"("items_to_increment" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_equipment_inventory_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_equipment_inventory_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_equipment_inventory_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_financial_categories_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_financial_categories_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_financial_categories_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_financial_expenses_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_financial_expenses_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_financial_expenses_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_financial_income_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_financial_income_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_financial_income_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_maintenance_schedule_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_maintenance_schedule_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_maintenance_schedule_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "service_role";
























GRANT ALL ON TABLE "public"."ai_assistant_messages" TO "anon";
GRANT ALL ON TABLE "public"."ai_assistant_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_assistant_messages" TO "service_role";



GRANT ALL ON TABLE "public"."ai_knowledge_base" TO "anon";
GRANT ALL ON TABLE "public"."ai_knowledge_base" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_knowledge_base" TO "service_role";



GRANT ALL ON TABLE "public"."ai_knowledge_sections" TO "anon";
GRANT ALL ON TABLE "public"."ai_knowledge_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_knowledge_sections" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_knowledge_sections_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_knowledge_sections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_knowledge_sections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_equipment" TO "anon";
GRANT ALL ON TABLE "public"."booking_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_equipment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";
GRANT INSERT ON TABLE "public"."bookings" TO "booking_creator";



GRANT ALL ON SEQUENCE "public"."bookings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bookings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bookings_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."bookings_id_seq" TO "booking_creator";



GRANT ALL ON TABLE "public"."business_settings" TO "anon";
GRANT ALL ON TABLE "public"."business_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."business_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."business_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."business_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."business_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."contact_messages" TO "anon";
GRANT ALL ON TABLE "public"."contact_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."coupons" TO "anon";
GRANT ALL ON TABLE "public"."coupons" TO "authenticated";
GRANT ALL ON TABLE "public"."coupons" TO "service_role";



GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_notes" TO "anon";
GRANT ALL ON TABLE "public"."customer_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."customers" TO "booking_creator";



GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."customers_id_seq" TO "booking_creator";



GRANT ALL ON TABLE "public"."date_specific_availability" TO "anon";
GRANT ALL ON TABLE "public"."date_specific_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."date_specific_availability" TO "service_role";



GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."driver_verification_documents" TO "anon";
GRANT ALL ON TABLE "public"."driver_verification_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_verification_documents" TO "service_role";



GRANT ALL ON TABLE "public"."dump_fees" TO "anon";
GRANT ALL ON TABLE "public"."dump_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."dump_fees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dump_fees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dump_fees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dump_fees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_verifications" TO "anon";
GRANT ALL ON TABLE "public"."email_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."email_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."equipment" TO "anon";
GRANT ALL ON TABLE "public"."equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_inventory" TO "anon";
GRANT ALL ON TABLE "public"."equipment_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_inventory" TO "service_role";



GRANT ALL ON SEQUENCE "public"."equipment_inventory_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."equipment_inventory_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."equipment_inventory_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_pricing" TO "anon";
GRANT ALL ON TABLE "public"."equipment_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_pricing" TO "service_role";



GRANT ALL ON TABLE "public"."faqs" TO "anon";
GRANT ALL ON TABLE "public"."faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."faqs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."faqs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."faqs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."faqs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."financial_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_categories" TO "anon";
GRANT ALL ON TABLE "public"."financial_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_expenses" TO "anon";
GRANT ALL ON TABLE "public"."financial_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_income" TO "anon";
GRANT ALL ON TABLE "public"."financial_income" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_income" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_income_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_income_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_income_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_projections" TO "anon";
GRANT ALL ON TABLE "public"."financial_projections" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_projections" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_projections_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_projections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_projections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."financial_reports" TO "anon";
GRANT ALL ON TABLE "public"."financial_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."financial_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."financial_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."financial_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inventory_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inventory_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inventory_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_rules" TO "anon";
GRANT ALL ON TABLE "public"."inventory_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inventory_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inventory_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inventory_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."magic_link_tokens" TO "anon";
GRANT ALL ON TABLE "public"."magic_link_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."magic_link_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_schedule" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_schedule" TO "service_role";



GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rental_access_codes" TO "anon";
GRANT ALL ON TABLE "public"."rental_access_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_access_codes" TO "service_role";



GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "anon";
GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "service_role";



GRANT ALL ON TABLE "public"."reschedule_history_logs" TO "anon";
GRANT ALL ON TABLE "public"."reschedule_history_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."reschedule_history_logs" TO "service_role";



GRANT ALL ON TABLE "public"."resource_access_logs" TO "anon";
GRANT ALL ON TABLE "public"."resource_access_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_access_logs" TO "service_role";



GRANT ALL ON TABLE "public"."resources" TO "anon";
GRANT ALL ON TABLE "public"."resources" TO "authenticated";
GRANT ALL ON TABLE "public"."resources" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."service_availability" TO "anon";
GRANT ALL ON TABLE "public"."service_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."service_availability" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_availability_id_seq1" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_availability_id_seq1" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_availability_id_seq1" TO "service_role";



GRANT ALL ON TABLE "public"."service_reminders" TO "anon";
GRANT ALL ON TABLE "public"."service_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."service_reminders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_payment_info" TO "anon";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tax_records" TO "anon";
GRANT ALL ON TABLE "public"."tax_records" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_records" TO "service_role";



GRANT ALL ON TABLE "public"."typing_indicators" TO "anon";
GRANT ALL ON TABLE "public"."typing_indicators" TO "authenticated";
GRANT ALL ON TABLE "public"."typing_indicators" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."verification_image_history" TO "anon";
GRANT ALL ON TABLE "public"."verification_image_history" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_image_history" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























