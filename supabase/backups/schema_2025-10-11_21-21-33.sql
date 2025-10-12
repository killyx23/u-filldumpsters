

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


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."availability_time_type" AS ENUM (
    'window',
    'hourly'
);


ALTER TYPE "public"."availability_time_type" OWNER TO "postgres";


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
  -- Clean the phone number to store only digits
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');

  -- Check if a customer with the given email already exists
  SELECT id INTO customer_id_var FROM public.customers WHERE email = NEW.email;

  -- Extract flags from the addons JSON
  unverified_address_flag := COALESCE((NEW.addons->>'unverifiedAddress')::boolean, FALSE);
  verification_skipped_flag := COALESCE((NEW.addons->>'verificationSkipped')::boolean, FALSE);
  address_verification_skipped_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);

  -- If customer doesn't exist, create a new one
  IF customer_id_var IS NULL THEN
    INSERT INTO public.customers (name, email, phone, street, city, state, zip, unverified_address, has_incomplete_verification)
    VALUES (NEW.name, NEW.email, cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip, unverified_address_flag, verification_skipped_flag)
    RETURNING id INTO customer_id_var;
  -- If customer exists, update their details, ensuring flags are sticky (once true, stays true)
  ELSE
    UPDATE public.customers
    SET 
      name = NEW.name,
      phone = cleaned_phone,
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
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  
  -- Set initial status to pending_payment. The webhook will handle the final status.
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


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'is_admin', 'false')::boolean;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_equipment_quantities"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- This function handles both new rentals (INSERT) and returns (UPDATE)

    IF (TG_OP = 'INSERT') THEN
        -- On a new booking_equipment record, DECREMENT the total quantity
        UPDATE equipment e
        SET total_quantity = e.total_quantity - NEW.quantity
        WHERE e.id = NEW.equipment_id;
        RETURN NEW;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        -- On an update, if returned_at is newly set, INCREMENT the quantity
        -- This ensures we only add back to inventory once.
        IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
            UPDATE equipment e
            SET total_quantity = e.total_quantity + OLD.quantity -- Use OLD quantity to prevent exploits
            WHERE e.id = OLD.equipment_id;
        -- Optional: handle case where a return is undone
        ELSIF OLD.returned_at IS NOT NULL AND NEW.returned_at IS NULL THEN
             UPDATE equipment e
            SET total_quantity = e.total_quantity - OLD.quantity
            WHERE e.id = OLD.equipment_id;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_equipment_quantities"() OWNER TO "postgres";


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
    "reschedule_history" "jsonb"[]
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


ALTER TABLE "public"."bookings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."bookings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "user_id" "uuid"
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



CREATE TABLE IF NOT EXISTS "public"."daily_availability" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "service_id" integer NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "inventory_override" integer,
    "delivery_start_time" time without time zone,
    "delivery_end_time" time without time zone,
    "pickup_start_time" time without time zone,
    "pickup_end_time" time without time zone,
    "return_start_time" time without time zone,
    "return_end_time" time without time zone,
    "hourly_start_time" time without time zone,
    "hourly_end_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."daily_availability" OWNER TO "postgres";


ALTER TABLE "public"."daily_availability" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."daily_availability_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."date_specific_availability" (
    "id" integer NOT NULL,
    "service_id" integer NOT NULL,
    "date" "date" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "delivery_start_time" time without time zone,
    "delivery_end_time" time without time zone,
    "pickup_start_time" time without time zone,
    "pickup_end_time" time without time zone,
    "hourly_start_time" time without time zone,
    "hourly_end_time" time without time zone,
    "return_start_time" time without time zone,
    "return_end_time" time without time zone
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



CREATE TABLE IF NOT EXISTS "public"."equipment" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "total_quantity" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocks_all_services_when_rented" boolean DEFAULT false,
    "type" "text",
    "service_id_association" integer
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
    "delivery_start_time" time without time zone,
    "delivery_end_time" time without time zone,
    "pickup_start_time" time without time zone,
    "pickup_end_time" time without time zone,
    "return_start_time" time without time zone,
    "return_end_time" time without time zone,
    "hourly_start_time" time without time zone,
    "hourly_end_time" time without time zone,
    "is_available" boolean DEFAULT true NOT NULL,
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
    "features" "jsonb"
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



CREATE TABLE IF NOT EXISTS "public"."unavailable_dates" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "service_id" integer
);


ALTER TABLE "public"."unavailable_dates" OWNER TO "postgres";


COMMENT ON COLUMN "public"."unavailable_dates"."service_id" IS 'If NULL, applies to all services. Otherwise, specific to a service_id.';



ALTER TABLE "public"."unavailable_dates" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."unavailable_dates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."contact_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."contact_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."customers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."customers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."date_specific_availability" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."date_specific_availability_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inventory_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inventory_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."daily_availability"
    ADD CONSTRAINT "daily_availability_date_service_id_key" UNIQUE ("date", "service_id");



ALTER TABLE ONLY "public"."daily_availability"
    ADD CONSTRAINT "daily_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_service_id_date_key" UNIQUE ("service_id", "date");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_pkey1" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_service_id_day_of_week_key" UNIQUE ("service_id", "day_of_week");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_day_unique" UNIQUE ("service_id", "day_of_week");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unavailable_dates"
    ADD CONSTRAINT "unavailable_dates_date_key" UNIQUE ("date");



ALTER TABLE ONLY "public"."unavailable_dates"
    ADD CONSTRAINT "unavailable_dates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "unique_booking_review" UNIQUE ("booking_id");



CREATE INDEX "customers_user_id_idx" ON "public"."customers" USING "btree" ("user_id");



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_booking_id" ON "public"."customer_notes" USING "btree" ("booking_id");



CREATE INDEX "idx_customer_notes_customer_id" ON "public"."customer_notes" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_parent_note_id" ON "public"."customer_notes" USING "btree" ("parent_note_id");



CREATE INDEX "idx_customer_notes_thread_id" ON "public"."customer_notes" USING "btree" ("thread_id");



CREATE INDEX "idx_customers_user_id" ON "public"."customers" USING "btree" ("id");



CREATE OR REPLACE TRIGGER "before_customer_insert_generate_id" BEFORE INSERT ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."generate_customer_id"();



CREATE OR REPLACE TRIGGER "on_booking_equipment_change" AFTER INSERT OR UPDATE ON "public"."booking_equipment" FOR EACH ROW EXECUTE FUNCTION "public"."update_equipment_quantities"();



CREATE OR REPLACE TRIGGER "on_booking_insert" BEFORE INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_booking"();



CREATE OR REPLACE TRIGGER "on_booking_insert_or_update_create_note" AFTER INSERT OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."add_booking_notes_to_customer_notes"();



CREATE OR REPLACE TRIGGER "on_new_note" AFTER INSERT ON "public"."customer_notes" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_note"();



CREATE OR REPLACE TRIGGER "on_note_read_status_change" AFTER UPDATE ON "public"."customer_notes" FOR EACH ROW WHEN (("old"."is_read" IS DISTINCT FROM "new"."is_read")) EXECUTE FUNCTION "public"."update_customer_unread_status_from_notes"();



CREATE OR REPLACE TRIGGER "on_payment_info_insert_sync_customer" AFTER INSERT ON "public"."stripe_payment_info" FOR EACH ROW EXECUTE FUNCTION "public"."sync_stripe_ids_to_customer"();



CREATE OR REPLACE TRIGGER "on_review_insert_create_note" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."add_review_to_customer_notes"();



CREATE OR REPLACE TRIGGER "on_service_availability_update" BEFORE UPDATE ON "public"."service_availability" FOR EACH ROW EXECUTE FUNCTION "public"."update_service_availability_updated_at"();



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



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



ALTER TABLE ONLY "public"."daily_availability"
    ADD CONSTRAINT "daily_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."date_specific_availability"
    ADD CONSTRAINT "date_specific_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_service_id_association_fkey" FOREIGN KEY ("service_id_association") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "fk_booking" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "fk_customer" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unavailable_dates"
    ADD CONSTRAINT "fk_service" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id");



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."service_availability"
    ADD CONSTRAINT "service_availability_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage all reviews" ON "public"."reviews" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Admins can manage bookings" ON "public"."bookings" TO "authenticated" USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Allow admin to update services" ON "public"."services" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow all for Admin Dashboard" ON "public"."service_availability" USING (("auth"."role"() = 'Admin Dashboard'::"text")) WITH CHECK (("auth"."role"() = 'Admin Dashboard'::"text"));



CREATE POLICY "Allow all for admin" ON "public"."coupons" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for admin" ON "public"."daily_availability" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow all for admin" ON "public"."service_availability" USING (("auth"."role"() = 'admin'::"text")) WITH CHECK (("auth"."role"() = 'admin'::"text"));



CREATE POLICY "Allow all for admins" ON "public"."date_specific_availability" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow all for admins" ON "public"."inventory_items" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow all for admins" ON "public"."inventory_rules" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow insert for authenticated users" ON "public"."date_specific_availability" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow public read" ON "public"."daily_availability" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to all" ON "public"."service_availability" FOR SELECT USING (true);



CREATE POLICY "Allow read for all" ON "public"."services" FOR SELECT USING (true);



CREATE POLICY "Allow select for authenticated users" ON "public"."date_specific_availability" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow update for authenticated users" ON "public"."date_specific_availability" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Customers can create reviews for their own bookings" ON "public"."reviews" FOR INSERT WITH CHECK (((( SELECT "bookings"."customer_id"
   FROM "public"."bookings"
  WHERE ("bookings"."id" = "reviews"."booking_id")) = ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))) AND (( SELECT "bookings"."status"
   FROM "public"."bookings"
  WHERE ("bookings"."id" = "reviews"."booking_id")) = 'Completed'::"text")));



CREATE POLICY "Customers can read own row" ON "public"."customers" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Customers can update own row" ON "public"."customers" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Public can read approved reviews" ON "public"."reviews" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Public read daily availability" ON "public"."daily_availability" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."booking_equipment" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."bookings" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."contact_messages" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."customer_notes" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."customers" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."equipment" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."reviews" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."stripe_payment_info" USING (true) WITH CHECK (true);



CREATE POLICY "TEMP_DEBUG_ALLOW_ALL" ON "public"."unavailable_dates" USING (true) WITH CHECK (true);



CREATE POLICY "anon_can_insert_booking" ON "public"."bookings" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon_can_insert_customer_notes" ON "public"."customer_notes" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon_can_insert_customers" ON "public"."customers" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon_can_see_services" ON "public"."services" FOR SELECT TO "anon" USING (true);



CREATE POLICY "anon_can_update_customers" ON "public"."customers" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."booking_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."date_specific_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_payment_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unavailable_dates" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









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



GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_customer_unread_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_stripe_ids_to_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_unread_status_from_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_equipment_quantities"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_equipment_quantities"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_equipment_quantities"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_service_availability_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_coupon"("coupon_code" "text", "service_id_arg" integer) TO "service_role";


















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



GRANT ALL ON TABLE "public"."daily_availability" TO "anon";
GRANT ALL ON TABLE "public"."daily_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_availability" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_availability_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_availability_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_availability_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."date_specific_availability" TO "anon";
GRANT ALL ON TABLE "public"."date_specific_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."date_specific_availability" TO "service_role";



GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."date_specific_availability_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."equipment" TO "anon";
GRANT ALL ON TABLE "public"."equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."equipment_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_payment_info" TO "anon";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."unavailable_dates" TO "anon";
GRANT ALL ON TABLE "public"."unavailable_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."unavailable_dates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."unavailable_dates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."unavailable_dates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."unavailable_dates_id_seq" TO "service_role";









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






























RESET ALL;
