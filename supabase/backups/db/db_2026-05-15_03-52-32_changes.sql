
  create table "public"."pending_customers" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "name" text,
    "phone" text,
    "street" text,
    "city" text,
    "state" text,
    "zip" text,
    "created_at" timestamp with time zone default now(),
    "is_verified" boolean default false,
    "booking_id" bigint,
    "service_id" integer,
    "plan_data" jsonb,
    "total_price" numeric(10,2),
    "base_price" numeric(10,2),
    "drop_off_date" date,
    "pickup_date" date,
    "drop_off_time_slot" text,
    "pickup_time_slot" text,
    "addons_data" jsonb,
    "booking_data" jsonb,
    "delivery_service" boolean default false,
    "verified_at" timestamp with time zone,
    "first_name" text,
    "last_name" text,
    "contact_address" jsonb,
    "delivery_address" jsonb,
    "notes" text
      );


alter table "public"."pending_customers" enable row level security;

CREATE INDEX idx_pending_customers_booking_id ON public.pending_customers USING btree (booking_id);

CREATE INDEX idx_pending_customers_email ON public.pending_customers USING btree (email);

CREATE UNIQUE INDEX idx_pending_customers_email_unverified ON public.pending_customers USING btree (lower(email)) WHERE ((is_verified = false) OR (is_verified IS NULL));

CREATE INDEX idx_pending_customers_verified ON public.pending_customers USING btree (is_verified);

CREATE UNIQUE INDEX pending_customers_email_key ON public.pending_customers USING btree (email);

CREATE UNIQUE INDEX pending_customers_pkey ON public.pending_customers USING btree (id);

alter table "public"."pending_customers" add constraint "pending_customers_pkey" PRIMARY KEY using index "pending_customers_pkey";

alter table "public"."pending_customers" add constraint "pending_customers_email_key" UNIQUE using index "pending_customers_email_key";

set check_function_bodies = off;

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

grant delete on table "public"."pending_customers" to "anon";

grant insert on table "public"."pending_customers" to "anon";

grant references on table "public"."pending_customers" to "anon";

grant select on table "public"."pending_customers" to "anon";

grant trigger on table "public"."pending_customers" to "anon";

grant truncate on table "public"."pending_customers" to "anon";

grant update on table "public"."pending_customers" to "anon";

grant delete on table "public"."pending_customers" to "authenticated";

grant insert on table "public"."pending_customers" to "authenticated";

grant references on table "public"."pending_customers" to "authenticated";

grant select on table "public"."pending_customers" to "authenticated";

grant trigger on table "public"."pending_customers" to "authenticated";

grant truncate on table "public"."pending_customers" to "authenticated";

grant update on table "public"."pending_customers" to "authenticated";

grant delete on table "public"."pending_customers" to "service_role";

grant insert on table "public"."pending_customers" to "service_role";

grant references on table "public"."pending_customers" to "service_role";

grant select on table "public"."pending_customers" to "service_role";

grant trigger on table "public"."pending_customers" to "service_role";

grant truncate on table "public"."pending_customers" to "service_role";

grant update on table "public"."pending_customers" to "service_role";


  create policy "public_insert_pending_customers"
  on "public"."pending_customers"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "public_select_pending_customers"
  on "public"."pending_customers"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public_update_pending_customers"
  on "public"."pending_customers"
  as permissive
  for update
  to anon, authenticated
using (true)
with check (true);



  create policy "service_role_full_access_pending_customers"
  on "public"."pending_customers"
  as permissive
  for all
  to service_role
using (true)
with check (true);


CREATE TRIGGER trigger_cleanup_pending_customers AFTER INSERT ON public.pending_customers FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_old_pending_customers();



