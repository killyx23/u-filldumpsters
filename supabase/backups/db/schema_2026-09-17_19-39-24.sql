

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


CREATE OR REPLACE FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  t record;
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT * INTO t FROM public.feedback_tokens WHERE token = p_token;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Submit the feedback form before chatting');
  END IF;

  IF t.chat_closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback conversation is closed', 'mode', 'closed');
  END IF;

  IF t.chat_expires_at IS NULL OR t.chat_expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback conversation link has expired', 'mode', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'token_id', t.id,
    'customer_id', t.customer_id,
    'booking_id', t.booking_id,
    'used_at', t.used_at,
    'chat_expires_at', t.chat_expires_at,
    'conversation_id', 'cust_' || t.customer_id::text
  );
END;
$$;


ALTER FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."abandoned_checkout_service_tags"("p_service_name" "text", "p_plan" "jsonb", "p_addons" "jsonb") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  tags text[] := '{}';
  name_lc text;
  plan_id int;
BEGIN
  name_lc := lower(COALESCE(p_service_name, p_plan->>'name', ''));
  plan_id := NULLIF(p_plan->>'id', '')::int;

  IF plan_id = 2 OR name_lc ~ 'dump.?trailer|dump.?loader|trailer' THEN
    tags := array_append(tags, 'dump-trailer');
  END IF;

    IF plan_id = 1 OR name_lc ~ 'dumpster' THEN
      tags := array_append(tags, 'dumpster');
    END IF;

    IF name_lc ~ 'compact' THEN
      tags := array_append(tags, 'compact-equipment');
    END IF;

  IF name_lc ~ 'rock|mulch|gravel|material' THEN
    tags := array_append(tags, 'materials');
  END IF;

  IF COALESCE((p_addons->>'isDelivery')::boolean, false)
     OR COALESCE((p_addons->>'deliveryService')::boolean, false)
     OR name_lc ~ 'delivery' THEN
    tags := array_append(tags, 'delivery');
  END IF;

  IF COALESCE(array_length(tags, 1), 0) = 0 THEN
    tags := ARRAY['other-service'];
  END IF;

  RETURN tags;
END;
$$;


ALTER FUNCTION "public"."abandoned_checkout_service_tags"("p_service_name" "text", "p_plan" "jsonb", "p_addons" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_referral_for_completed_booking"("p_booking_id" bigint) RETURNS TABLE("referral_id" bigint, "activated" boolean, "bonus_dollars" numeric, "referrer_customer_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking record;
  v_referral public.referrals%ROWTYPE;
  v_bonus numeric(10,2);
  v_wallet_result record;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT b.id, b.customer_id, b.status
    INTO v_booking
    FROM public.bookings b
   WHERE b.id = p_booking_id
   LIMIT 1;

  IF NOT FOUND OR v_booking.customer_id IS NULL THEN
    RETURN;
  END IF;

  IF lower(COALESCE(v_booking.status, '')) <> 'completed' THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE r.pending_booking_id = p_booking_id
     AND r.referee_customer_id = v_booking.customer_id
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;
  referrer_customer_id := v_referral.referrer_customer_id;

  v_bonus := round(COALESCE(v_referral.referrer_bonus_dollars_awarded, 0), 2);
  IF v_bonus <= 0 THEN
    v_bonus := round(COALESCE((
      SELECT ls.referral_bonus_dollars
        FROM public.loyalty_settings ls
       ORDER BY ls.id DESC
       LIMIT 1
    ), 25), 2);
  END IF;

  bonus_dollars := v_bonus;

  IF v_referral.status = 'rewarded' AND v_referral.reward_activated_at IS NOT NULL THEN
    activated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.referrals
     SET status = CASE WHEN v_bonus > 0 THEN 'rewarded' ELSE 'completed' END,
         completed_booking_id = COALESCE(completed_booking_id, p_booking_id),
         pending_booking_id = COALESCE(pending_booking_id, p_booking_id),
         completed_at = COALESCE(completed_at, now())
   WHERE id = v_referral.id;

  IF v_bonus > 0 THEN
    SELECT *
      INTO v_wallet_result
      FROM public.adjust_referral_wallet(
        v_referral.referrer_customer_id,
        v_bonus,
        'activated',
        p_booking_id,
        v_referral.id,
        'Referral activated after booking #' || p_booking_id::text || ' completed'
      );

    activated := NOT COALESCE(v_wallet_result.already_processed, false);

    IF activated THEN
      UPDATE public.referrals
         SET reward_activated_at = now(),
             referrer_bonus_dollars_awarded = v_bonus
       WHERE id = v_referral.id;

      UPDATE public.bookings
         SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
           'referralDollarsActivated', v_bonus,
           'referralDollarsPending', 0
         )
       WHERE id = p_booking_id;
    END IF;
  ELSE
    activated := false;
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."activate_referral_for_completed_booking"("p_booking_id" bigint) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."adjust_loyalty_points"("p_customer_id" bigint, "p_points" integer, "p_transaction_type" "text", "p_booking_id" bigint DEFAULT NULL::bigint, "p_referral_id" bigint DEFAULT NULL::bigint, "p_notes" "text" DEFAULT NULL::"text") RETURNS TABLE("already_processed" boolean, "new_balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_amount integer;
  v_balance integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_amount := abs(COALESCE(p_points, 0));
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid points amount';
  END IF;

  IF p_transaction_type = 'earned' AND p_booking_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type = 'earned'
    ) THEN
      SELECT lp.points_balance
        INTO v_balance
        FROM public.loyalty_points lp
       WHERE lp.customer_id = p_customer_id;

      already_processed := true;
      new_balance := COALESCE(v_balance, 0);
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.loyalty_points (
    customer_id,
    points_balance,
    total_points_earned,
    total_points_redeemed
  )
  VALUES (p_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance
    INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = p_customer_id
   FOR UPDATE;

  IF p_transaction_type = 'redeemed' THEN
    IF COALESCE(v_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient points';
    END IF;

    UPDATE public.loyalty_points
       SET points_balance = points_balance - v_amount,
           total_points_redeemed = total_points_redeemed + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'redeemed',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSIF p_transaction_type = 'earned' THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_amount,
           total_points_earned = total_points_earned + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'earned',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSIF p_transaction_type = 'referral_bonus' THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_amount,
           total_points_earned = total_points_earned + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'referral_bonus',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type: %', p_transaction_type;
  END IF;

  already_processed := false;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."adjust_loyalty_points"("p_customer_id" bigint, "p_points" integer, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_referral_wallet"("p_customer_id" bigint, "p_amount" numeric, "p_transaction_type" "text", "p_booking_id" bigint DEFAULT NULL::bigint, "p_referral_id" bigint DEFAULT NULL::bigint, "p_notes" "text" DEFAULT NULL::"text") RETURNS TABLE("already_processed" boolean, "pending_balance" numeric, "available_balance" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_amount numeric(10,2);
  v_wallet public.customer_referral_wallets%ROWTYPE;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_amount := round(abs(COALESCE(p_amount, 0)), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid wallet amount';
  END IF;

  INSERT INTO public.customer_referral_wallets (customer_id)
  VALUES (p_customer_id)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT *
    INTO v_wallet
    FROM public.customer_referral_wallets
   WHERE customer_id = p_customer_id
   FOR UPDATE;

  IF p_referral_id IS NOT NULL
     AND p_transaction_type IN ('pending_accrual', 'activated')
     AND EXISTS (
       SELECT 1
         FROM public.referral_wallet_transactions t
        WHERE t.referral_id = p_referral_id
          AND t.transaction_type = p_transaction_type
     )
  THEN
    already_processed := true;
    pending_balance := COALESCE(v_wallet.pending_balance, 0);
    available_balance := COALESCE(v_wallet.available_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_booking_id IS NOT NULL
     AND p_transaction_type = 'redeemed'
     AND EXISTS (
       SELECT 1
         FROM public.referral_wallet_transactions t
        WHERE t.customer_id = p_customer_id
          AND t.booking_id = p_booking_id
          AND t.transaction_type = 'redeemed'
     )
  THEN
    already_processed := true;
    pending_balance := COALESCE(v_wallet.pending_balance, 0);
    available_balance := COALESCE(v_wallet.available_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_transaction_type = 'pending_accrual' THEN
    UPDATE public.customer_referral_wallets w
       SET pending_balance = COALESCE(w.pending_balance, 0) + v_amount,
           total_earned = COALESCE(w.total_earned, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'activated' THEN
    IF COALESCE(v_wallet.pending_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient pending referral balance';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET pending_balance = COALESCE(w.pending_balance, 0) - v_amount,
           available_balance = COALESCE(w.available_balance, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'redeemed' THEN
    IF COALESCE(v_wallet.available_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient referral dollars';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) - v_amount,
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'admin_adjustment_add' THEN
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) + v_amount,
           total_earned = COALESCE(w.total_earned, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'admin_adjustment_remove' THEN
    IF COALESCE(v_wallet.available_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient referral dollars';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) - v_amount,
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'expired' THEN
    UPDATE public.customer_referral_wallets w
       SET available_balance = GREATEST(0, COALESCE(w.available_balance, 0) - v_amount),
           pending_balance = GREATEST(
             0,
             COALESCE(w.pending_balance, 0) - GREATEST(0, v_amount - COALESCE(w.available_balance, 0))
           ),
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type: %', p_transaction_type;
  END IF;

  INSERT INTO public.referral_wallet_transactions (
    customer_id,
    referral_id,
    booking_id,
    transaction_type,
    amount,
    pending_balance_after,
    available_balance_after,
    notes
  ) VALUES (
    p_customer_id,
    p_referral_id,
    p_booking_id,
    p_transaction_type,
    v_amount,
    COALESCE(v_wallet.pending_balance, 0),
    COALESCE(v_wallet.available_balance, 0),
    p_notes
  );

  already_processed := false;
  pending_balance := COALESCE(v_wallet.pending_balance, 0);
  available_balance := COALESCE(v_wallet.available_balance, 0);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."adjust_referral_wallet"("p_customer_id" bigint, "p_amount" numeric, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_loyalty_points"("p_customer_id" bigint, "p_points_delta" integer, "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("new_balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_delta integer;
  v_balance integer;
  v_tx_type text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_delta := COALESCE(p_points_delta, 0);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'points delta must be non-zero';
  END IF;

  INSERT INTO public.loyalty_points (
    customer_id,
    points_balance,
    total_points_earned,
    total_points_redeemed
  )
  VALUES (p_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance
    INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = p_customer_id
   FOR UPDATE;

  IF v_delta > 0 THEN
    v_tx_type := 'admin_adjustment_add';
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_earned = total_points_earned + v_delta,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;
  ELSE
    v_tx_type := 'admin_adjustment_remove';
    IF COALESCE(v_balance, 0) + v_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient points';
    END IF;
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_redeemed = total_points_redeemed + abs(v_delta),
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;
  END IF;

  INSERT INTO public.loyalty_transactions (
    customer_id,
    transaction_type,
    points_amount,
    notes
  )
  VALUES (
    p_customer_id,
    v_tx_type,
    abs(v_delta),
    COALESCE(p_reason, 'Manual admin adjustment')
  );

  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."admin_adjust_loyalty_points"("p_customer_id" bigint, "p_points_delta" integer, "p_reason" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "pin_notification_sent_at" timestamp with time zone,
    "delivery_type" "text",
    "tax_jurisdiction" "text",
    "tax_zip_used" "text",
    "rescheduled_to_booking_id" bigint,
    "rescheduled_from_booking_id" bigint,
    "archive_details" "jsonb",
    "payment_delta_details" "jsonb",
    "charge_outcome_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "receipt_original_snapshot" "jsonb",
    "receipt_status_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cancellation_details" "jsonb",
    "rental_started_notified_at" timestamp with time zone,
    "return_notified_at" timestamp with time zone,
    "follow_up_resolution" "jsonb",
    "drop_off_window_start" time without time zone,
    "drop_off_window_end" time without time zone,
    "pickup_window_start" time without time zone,
    "pickup_window_end" time without time zone,
    "pin_reminder_sent_at" timestamp with time zone,
    "checkout_last_seen_at" timestamp with time zone,
    "confirmation_email_sent_at" timestamp with time zone,
    CONSTRAINT "bookings_delivery_type_check" CHECK (("delivery_type" = ANY (ARRAY['delivery'::"text", 'self_service_trailer'::"text", 'self_pickup'::"text"])))
);

ALTER TABLE ONLY "public"."bookings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bookings"."distance_miles" IS 'Total miles for complete 3-point route: Business → Customer → Landfill → Business';



COMMENT ON COLUMN "public"."bookings"."mileage_charge" IS 'Mileage fee calculated at booking time (distance_miles * rate)';



COMMENT ON COLUMN "public"."bookings"."delivery_type" IS 'Delivery mode: delivery, self_service_trailer, or self_pickup';



COMMENT ON COLUMN "public"."bookings"."tax_jurisdiction" IS 'Tax jurisdiction label applied at booking time';



COMMENT ON COLUMN "public"."bookings"."tax_zip_used" IS 'ZIP code used for tax rate lookup';



COMMENT ON COLUMN "public"."bookings"."rescheduled_to_booking_id" IS 'When status is Rescheduled, points to the replacement booking.';



COMMENT ON COLUMN "public"."bookings"."rescheduled_from_booking_id" IS 'When this booking replaced another, points to the original booking.';



COMMENT ON COLUMN "public"."bookings"."archive_details" IS 'Audit trail for cancel/reschedule actions (who, when, original booking info).';



COMMENT ON COLUMN "public"."bookings"."payment_delta_details" IS 'Structured data about amount differences that require additional charge approval.';



COMMENT ON COLUMN "public"."bookings"."charge_outcome_history" IS 'Audit array of charge attempts, cancellations, and manual captures.';



COMMENT ON COLUMN "public"."bookings"."receipt_original_snapshot" IS 'Immutable first receipt snapshot for legal/historical comparison.';



COMMENT ON COLUMN "public"."bookings"."receipt_status_history" IS 'Status/timeline snapshots appended whenever booking state materially changes.';



COMMENT ON COLUMN "public"."bookings"."rental_started_notified_at" IS 'When the rental-started email/SMS was sent after first unlock.';



COMMENT ON COLUMN "public"."bookings"."return_notified_at" IS 'When the return thank-you email/SMS was sent after final lock.';



COMMENT ON COLUMN "public"."bookings"."follow_up_resolution" IS 'Admin resolution of flagged follow-up: reason, closes_flag, notes, updated_at/by, and history trail.';



COMMENT ON COLUMN "public"."bookings"."drop_off_window_start" IS 'Parsed from drop_off_time_slot. The text column remains the display value.';



COMMENT ON COLUMN "public"."bookings"."pickup_window_start" IS 'Parsed from pickup_time_slot. The text column remains the display value.';



COMMENT ON COLUMN "public"."bookings"."pin_reminder_sent_at" IS 'When the 1-hour-before PIN reminder email/SMS was sent.';



COMMENT ON COLUMN "public"."bookings"."checkout_last_seen_at" IS 'Last client heartbeat while unpaid checkout is in progress.';



COMMENT ON COLUMN "public"."bookings"."confirmation_email_sent_at" IS 'When the booking confirmation email was claimed/sent. Null means not yet sent. Used for send-once idempotency.';



CREATE OR REPLACE FUNCTION "public"."booking_has_delivery_trip"("p_booking" "public"."bookings") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_customer_miles numeric;
  v_one_way numeric;
BEGIN
  SELECT c.distance_miles INTO v_customer_miles
  FROM public.customers c
  WHERE c.id = p_booking.customer_id;

  v_one_way := COALESCE(
    NULLIF(p_booking.distance_miles, 0),
    NULLIF(v_customer_miles, 0),
    NULLIF((p_booking.addons->>'oneWayDistanceMiles')::numeric, 0),
    0
  );

  RETURN v_one_way > 0;
END;
$$;


ALTER FUNCTION "public"."booking_has_delivery_trip"("p_booking" "public"."bookings") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_is_company_delivery"("p_booking" "public"."bookings") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_addons jsonb := COALESCE(p_booking.addons, '{}'::jsonb);
  v_plan jsonb := COALESCE(p_booking.plan, '{}'::jsonb);
  v_plan_id bigint;
  v_name text;
BEGIN
  IF COALESCE((v_addons->>'isDelivery')::boolean, false)
     OR COALESCE((v_addons->>'deliveryService')::boolean, false) THEN
    RETURN true;
  END IF;

  v_plan_id := NULLIF(v_plan->>'id', '')::bigint;
  v_name := lower(COALESCE(v_plan->>'name', ''));

  IF v_plan_id IN (1, 4) THEN
    RETURN true;
  END IF;
  IF v_plan_id = 2 AND COALESCE((v_addons->>'isDelivery')::boolean, false) THEN
    RETURN true;
  END IF;
  IF v_name LIKE '%delivery%' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."booking_is_company_delivery"("p_booking" "public"."bookings") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") RETURNS SETOF "date"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  select d::date
    from generate_series(p_drop_off, greatest(p_pickup, p_drop_off), interval '1 day') d
   where case coalesce(p_occupancy, 'range')
           when 'dropoff_only' then d::date = p_drop_off
           when 'dropoff_and_pickup_only' then d::date in (p_drop_off, p_pickup)
           else true
         end;
$$;


ALTER FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") IS 'Set of dates on which a booking occupies its resources, per the service occupancy_model.';



CREATE OR REPLACE FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) RETURNS TABLE("resource_id" integer, "quantity" integer, "reserved_date" "date", "slot_start" time without time zone, "slot_end" time without time zone, "granularity" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  v_req record;
  v_day date;
begin
  for v_req in
    select ir.inventory_item_id,
           ir.quantity_required,
           ir.scheduling_granularity,
           coalesce(ir.occupancy_model::text, s.occupancy_model::text, 'range') as occupancy_model
      from public.inventory_rules ir
      join public.services s on s.id = ir.service_id
     where ir.service_id = p_service_id
  loop
    if v_req.scheduling_granularity = 'slot'
       and v_req.occupancy_model in ('dropoff_only', 'dropoff_and_pickup_only')
    then
      resource_id := v_req.inventory_item_id;
      quantity := v_req.quantity_required;
      reserved_date := p_drop_off_date;
      slot_start := coalesce(p_drop_off_window_start, time '00:00:00');
      slot_end := coalesce(p_drop_off_window_end, time '23:59:59');
      granularity := 'slot';
      return next;

      if v_req.occupancy_model = 'dropoff_and_pickup_only' and p_pickup_date is not null then
        resource_id := v_req.inventory_item_id;
        quantity := v_req.quantity_required;
        reserved_date := p_pickup_date;
        slot_start := coalesce(p_pickup_window_start, time '00:00:00');
        slot_end := coalesce(p_pickup_window_end, time '23:59:59');
        granularity := 'slot';
        return next;
      end if;
    else
      for v_day in
        select d from public.booking_occupied_days(v_req.occupancy_model, p_drop_off_date, p_pickup_date) d
      loop
        resource_id := v_req.inventory_item_id;
        quantity := v_req.quantity_required;
        reserved_date := v_day;
        slot_start := null;
        slot_end := null;
        granularity := 'day';
        return next;
      end loop;
    end if;
  end loop;
  return;
end;
$$;


ALTER FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) IS 'What a booking with this service/dates/windows would reserve. Shared by sync_booking_reservations (to write rows) and check_booking_inventory_capacity (to check before writing), so the two cannot drift.';



CREATE OR REPLACE FUNCTION "public"."booking_status_is_active"("p_status" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT coalesce(lower(p_status), '') IN (
    'confirmed',
    'rescheduled',
    'delivered',
    'waiting_to_be_returned',
    'pending_review',
    'pending_payment',
    'pending',
    'flagged'
  );
$$;


ALTER FUNCTION "public"."booking_status_is_active"("p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."booking_status_is_active"("p_status" "text") IS 'True when a booking in this status is holding inventory and must count against capacity. booking_not_finished is intentionally excluded so unfinished checkouts free dates/slots.';



CREATE OR REPLACE FUNCTION "public"."booking_status_is_converted"("p_status" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT coalesce(lower(p_status), '') IN (
    'confirmed',
    'rescheduled',
    'delivered',
    'waiting_to_be_returned',
    'pending_review',
    'pending',
    'flagged'
  );
$$;


ALTER FUNCTION "public"."booking_status_is_converted"("p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."booking_status_is_converted"("p_status" "text") IS 'True when a booking is a real paid/active rental (not pending_payment or booking_not_finished).';



CREATE OR REPLACE FUNCTION "public"."bookings_loyalty_sync_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Full cancel: reverse any remaining earned points (idempotent)
  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.reverse_booking_loyalty_points(
      NEW.id,
      format('Cancelled booking #%s — loyalty points reversed', NEW.id)
    );
    RETURN NEW;
  END IF;

  -- Charge/reschedule total change: re-sync points to new total when loyalty already exists
  IF NEW.total_price IS DISTINCT FROM OLD.total_price
     AND NEW.status IS DISTINCT FROM 'Cancelled'
     AND NEW.status IS DISTINCT FROM 'cancellation_pending'
  THEN
    PERFORM public.sync_booking_loyalty_to_total(
      NEW.id,
      NEW.total_price::numeric,
      format('Price update for booking #%s ($%s → $%s)', NEW.id, OLD.total_price, NEW.total_price)
    );
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."bookings_loyalty_sync_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_protection_cancel_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.cancel_booking_protection_plans(NEW.id);
  ELSIF OLD.status = 'Cancelled' AND NEW.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.reactivate_booking_protection_plans(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bookings_protection_cancel_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_tax_ledger_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.void_booking_tax_records(NEW.id, 'Booking cancelled');
    RETURN NEW;
  END IF;

  IF OLD.status = 'Cancelled' AND NEW.status IS DISTINCT FROM 'Cancelled' THEN
    UPDATE public.tax_records
       SET voided_at = NULL,
           void_reason = NULL
     WHERE booking_id = NEW.id;
  END IF;

  -- Keep ledger in sync when tax fields change on active bookings
  IF NEW.status IS DISTINCT FROM 'Cancelled'
     AND (
       NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.tax_rate_used IS DISTINCT FROM OLD.tax_rate_used
       OR NEW.subtotal_before_tax IS DISTINCT FROM OLD.subtotal_before_tax
       OR NEW.addons IS DISTINCT FROM OLD.addons
     )
  THEN
    IF COALESCE(NEW.tax_amount, 0) > 0 OR COALESCE(NEW.tax_rate_used, 0) > 0 THEN
      PERFORM public.upsert_booking_tax_record(NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bookings_tax_ledger_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.booking_protection_plans
     SET cancelled_at = timezone('utc', now()),
         cancellation_reason = COALESCE(cancellation_reason, 'Booking cancelled')
   WHERE booking_id = p_booking_id
     AND cancelled_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_booking_inventory_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_service_id integer;
  v_row record;
  v_total integer;
  v_name text;
  v_used integer;
begin
  if not public.booking_status_is_active(new.status) then
    return new;
  end if;

  v_service_id := public.resolve_booking_service_id(new.plan, new.addons);
  if v_service_id is null then
    raise log '[check_booking_inventory] plan.id missing or non-numeric, skipping capacity check';
    return new;
  end if;

  -- Only re-check when the reservation footprint is new, moves, or changes shape. A status
  -- step that leaves dates/windows/service alone (e.g. Confirmed -> Delivered) already owns
  -- its capacity, and re-validating it would make a pre-existing over-capacity booking
  -- unadministerable.
  if tg_op = 'UPDATE'
     and public.booking_status_is_active(old.status)
     and old.drop_off_date = new.drop_off_date
     and old.pickup_date = new.pickup_date
     and old.drop_off_window_start is not distinct from new.drop_off_window_start
     and old.drop_off_window_end is not distinct from new.drop_off_window_end
     and old.pickup_window_start is not distinct from new.pickup_window_start
     and old.pickup_window_end is not distinct from new.pickup_window_end
     and public.resolve_booking_service_id(old.plan, old.addons) = v_service_id
  then
    return new;
  end if;

  for v_row in
    select *
      from public.booking_reservation_rows(
             v_service_id,
             new.drop_off_date,
             new.pickup_date,
             new.drop_off_window_start,
             new.drop_off_window_end,
             new.pickup_window_start,
             new.pickup_window_end
           )
  loop
    select ii.total_quantity, ii.name into v_total, v_name
      from public.inventory_items ii
     where ii.id = v_row.resource_id;

    -- Serialises concurrent bookings competing for this resource. Without this lock two
    -- simultaneous checkouts each read the pre-insert count and both succeed.
    perform 1 from public.inventory_items where id = v_row.resource_id for update;

    -- Excludes this booking's own (not-yet-replaced) reservation rows, which matters on
    -- UPDATE: the old rows are still present until the AFTER trigger re-syncs them.
    v_used := public.resource_quantity_used(v_row.resource_id, v_row.reserved_date, v_row.slot_start, v_row.slot_end, new.id);

    if v_used + v_row.quantity > v_total then
      raise exception '"%" is fully booked between % and %: % of % units already in use.',
        v_name, new.drop_off_date, new.pickup_date, v_used, v_total
        using errcode = 'P0001',
              detail  = 'booking_capacity_exceeded',
              hint    = v_name;
    end if;
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."check_booking_inventory_capacity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_booking_inventory_capacity"() IS 'BEFORE INSERT OR UPDATE guard on bookings. Phase 2 rewrite of the Phase 1b trigger: capacity is now read from booking_resource_reservations via resource_quantity_used, the same function get-availability uses, instead of re-deriving usage from bookings.plan/addons JSONB.';



CREATE OR REPLACE FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval DEFAULT '02:00:00'::interval) RETURNS TABLE("booking_id" bigint, "restocked" boolean, "cancelled" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  rec record;
  result jsonb;
BEGIN
  FOR rec IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.status = 'pending_payment'
      AND b.created_at < now() - p_older_than
    ORDER BY b.id
  LOOP
    result := public.finalize_unfinished_checkout(rec.id, 'expired');
    booking_id := rec.id;
    restocked := COALESCE((result->>'restocked')::boolean, false);
    cancelled := COALESCE((result->>'ok')::boolean, false);
    RETURN NEXT;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) IS 'Cancels pending_payment bookings older than the given interval and restocks any unpaid equipment holds.';



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


CREATE OR REPLACE FUNCTION "public"."cleanup_old_pending_customers"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Delete unverified records older than 7 days
  DELETE FROM pending_customers
  WHERE is_verified = false
    AND created_at < NOW() - INTERVAL '7 days';
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_pending_customers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_points" integer DEFAULT 100) RETURNS TABLE("referral_id" bigint, "rewarded" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_bonus integer;
  v_adjust record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_booking_id IS NULL OR p_referee_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN;
  END IF;

  v_bonus := GREATEST(COALESCE(p_bonus_points, 0), 0);

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;

  IF v_referral.referrer_customer_id = p_referee_customer_id THEN
    rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_referral.completed_booking_id = p_booking_id THEN
    rewarded := v_referral.status = 'rewarded';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.referrals
     SET referee_customer_id = COALESCE(referee_customer_id, p_referee_customer_id),
         completed_booking_id = p_booking_id,
         status = CASE WHEN v_bonus > 0 THEN 'rewarded' ELSE 'completed' END,
         referrer_points_awarded = CASE WHEN v_bonus > 0 THEN v_bonus ELSE referrer_points_awarded END,
         completed_at = COALESCE(completed_at, now())
   WHERE id = v_referral.id;

  rewarded := false;

  IF v_bonus > 0 AND v_referral.status <> 'rewarded' THEN
    SELECT *
      INTO v_adjust
      FROM public.adjust_loyalty_points(
        v_referral.referrer_customer_id,
        v_bonus,
        'referral_bonus',
        p_booking_id,
        v_referral.id,
        'Referral bonus for booking #' || p_booking_id::text
      ) AS t(already_processed boolean, new_balance integer);

    rewarded := NOT COALESCE(v_adjust.already_processed, false);
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."complete_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_points" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_early_leave_feedback_token"("p_booking_id" bigint) RETURNS TABLE("token" "text", "customer_id" bigint, "email" "text", "first_name" "text", "site_path" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  b record;
  v_token text;
  v_expires timestamptz := timezone('utc', now()) + interval '30 days';
BEGIN
  SELECT
    bk.id,
    bk.customer_id,
    bk.email,
    bk.first_name,
    bk.name,
    bk.status
  INTO b
  FROM public.bookings bk
  WHERE bk.id = p_booking_id;

  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF b.customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking has no customer';
  END IF;

  IF b.email IS NULL OR length(trim(b.email)) = 0 THEN
    RAISE EXCEPTION 'Booking has no email';
  END IF;

  PERFORM public.mark_customer_feedback_lead(b.customer_id);

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.feedback_tokens (token, customer_id, booking_id, expires_at)
  VALUES (v_token, b.customer_id, b.id, v_expires);

  token := v_token;
  customer_id := b.customer_id;
  email := b.email;
  first_name := COALESCE(NULLIF(trim(b.first_name), ''), split_part(COALESCE(b.name, 'there'), ' ', 1), 'there');
  site_path := '/how-can-we-do-better?token=' || v_token;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."create_early_leave_feedback_token"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_pending_booking"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_id bigint;
  new_customer_id bigint;
  v_pending_id uuid;
  p record;
  b record;
  v_sibling bigint;
  v_hold_active boolean;
  v_drop_off date;
  v_pickup date;
  v_email text;
BEGIN
  BEGIN
    v_pending_id := NULLIF(trim(COALESCE(
      payload->>'pending_customer_id',
      payload->>'pending_id',
      ''
    )), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_pending_id := NULL;
  END;

  BEGIN
    v_drop_off := (payload->>'drop_off_date')::date;
  EXCEPTION WHEN others THEN
    v_drop_off := NULL;
  END;
  BEGIN
    v_pickup := (payload->>'pickup_date')::date;
  EXCEPTION WHEN others THEN
    v_pickup := NULL;
  END;

  v_email := lower(trim(COALESCE(payload->>'email', '')));

  IF v_pending_id IS NOT NULL THEN
    SELECT * INTO p
    FROM public.pending_customers
    WHERE id = v_pending_id
    FOR UPDATE;

    IF FOUND THEN
      v_email := lower(trim(COALESCE(NULLIF(p.email, ''), v_email)));
      v_drop_off := COALESCE(p.drop_off_date, v_drop_off);
      v_pickup := COALESCE(p.pickup_date, v_pickup);

      IF p.booking_id IS NOT NULL THEN
        SELECT * INTO b
        FROM public.bookings
        WHERE id = p.booking_id
        FOR UPDATE;

        IF FOUND AND lower(COALESCE(b.status, '')) = 'pending_payment' THEN
          v_hold_active := COALESCE(b.addons->>'equipment_hold_active', '') = 'true';
          RETURN jsonb_build_object(
            'id', b.id,
            'customer_id', b.customer_id,
            'reused', true,
            'already_converted', false,
            'equipment_hold_active', v_hold_active,
            'status', b.status
          );
        END IF;

        IF FOUND AND public.booking_status_is_converted(b.status) THEN
          RETURN jsonb_build_object(
            'id', b.id,
            'customer_id', b.customer_id,
            'reused', false,
            'already_converted', true,
            'equipment_hold_active', false,
            'status', b.status
          );
        END IF;

        UPDATE public.pending_customers
        SET booking_id = NULL
        WHERE id = p.id;
        p.booking_id := NULL;
      END IF;

      v_sibling := public.find_converted_checkout_sibling(
        COALESCE(NULLIF(v_email, ''), p.email),
        NULL,
        v_drop_off,
        v_pickup
      );
      IF v_sibling IS NOT NULL THEN
        UPDATE public.pending_customers
        SET booking_id = v_sibling
        WHERE id = p.id
          AND booking_id IS NULL;

        SELECT id, customer_id, status
          INTO b
          FROM public.bookings
         WHERE id = v_sibling;

        RETURN jsonb_build_object(
          'id', v_sibling,
          'customer_id', b.customer_id,
          'reused', false,
          'already_converted', true,
          'equipment_hold_active', false,
          'status', b.status
        );
      END IF;
    END IF;
  ELSIF v_email <> '' THEN
    v_sibling := public.find_converted_checkout_sibling(v_email, NULL, v_drop_off, v_pickup);
    IF v_sibling IS NOT NULL THEN
      SELECT id, customer_id, status INTO b FROM public.bookings WHERE id = v_sibling;
      RETURN jsonb_build_object(
        'id', v_sibling,
        'customer_id', b.customer_id,
        'reused', false,
        'already_converted', true,
        'equipment_hold_active', false,
        'status', b.status
      );
    END IF;
  END IF;

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
    subtotal_before_tax,
    tax_amount,
    tax_rate_used,
    delivery_type,
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
    COALESCE((payload->>'subtotal_before_tax')::numeric, 0),
    COALESCE((payload->>'tax_amount')::numeric, 0),
    COALESCE((payload->>'tax_rate_used')::numeric, 0),
    payload->>'delivery_type',
    'pending_payment',
    payload->>'notes',
    COALESCE((payload->>'was_verification_skipped')::boolean, false),
    payload->>'verification_notes'
  )
  RETURNING id, customer_id INTO new_id, new_customer_id;

  IF v_pending_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET booking_id = new_id
    WHERE id = v_pending_id;
  END IF;

  IF jsonb_typeof(payload->'addons'->'agreementFeeSnapshot') = 'array' THEN
    INSERT INTO public.booking_fee_snapshots (
      booking_id,
      fee_key,
      fee_name,
      fee_description,
      fee_value,
      is_percentage,
      snapshot_source,
      captured_at
    )
    SELECT
      new_id,
      COALESCE(item->>'fee_key', 'unknown_fee_key'),
      COALESCE(item->>'fee_name', item->>'fee_key', 'Unknown Fee'),
      item->>'fee_description',
      COALESCE(NULLIF(item->>'fee_value', '')::numeric, 0),
      COALESCE((item->>'is_percentage')::boolean, false),
      COALESCE(item->>'source', 'agreement_step6_acceptance'),
      COALESCE((item->>'captured_at')::timestamptz, NOW())
    FROM jsonb_array_elements(payload->'addons'->'agreementFeeSnapshot') AS item;
  END IF;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id,
    'reused', false,
    'already_converted', false,
    'equipment_hold_active', false,
    'status', 'pending_payment'
  );
END;
$$;


ALTER FUNCTION "public"."create_pending_booking"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  p record;
  svc record;
  v_plan jsonb;
  v_addons jsonb;
  v_booking_id bigint;
  v_existing_status text;
  v_existing_plan jsonb;
  v_delivery_type text;
  v_name text;
  v_service_name text;
  v_sibling bigint;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT * INTO p
  FROM public.pending_customers
  WHERE id = p_pending_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found');
  END IF;

  IF COALESCE(p.email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_required');
  END IF;

  v_addons := CASE
    WHEN p.addons_data IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(p.addons_data) = 'null' THEN '{}'::jsonb
    ELSE p.addons_data
  END;

  v_plan := CASE
    WHEN p.plan_data IS NULL THEN NULL
    WHEN jsonb_typeof(p.plan_data) = 'null' THEN NULL
    WHEN p.plan_data = '{}'::jsonb THEN NULL
    WHEN NULLIF(trim(COALESCE(p.plan_data->>'name', '')), '') IS NULL
         AND NULLIF(trim(COALESCE(p.plan_data->>'id', '')), '') IS NULL
      THEN NULL
    ELSE p.plan_data
  END;

  IF v_plan IS NULL AND p.service_id IS NOT NULL THEN
    SELECT id, name, description, base_price, price_unit, sale_price,
           homepage_description, weekly_rate, daily_rate, features,
           occupancy_model, mileage_rate, delivery_fee, customer_pickup
      INTO svc
      FROM public.services
     WHERE id = p.service_id;

    IF FOUND THEN
      v_plan := jsonb_build_object(
        'id', svc.id,
        'name', svc.name,
        'description', svc.description,
        'base_price', svc.base_price,
        'price', COALESCE(p.base_price, svc.base_price),
        'price_unit', svc.price_unit,
        'sale_price', svc.sale_price,
        'homepage_description', svc.homepage_description,
        'weekly_rate', svc.weekly_rate,
        'daily_rate', svc.daily_rate,
        'features', svc.features,
        'occupancy_model', svc.occupancy_model,
        'mileage_rate', svc.mileage_rate,
        'delivery_fee', svc.delivery_fee,
        'customer_pickup', svc.customer_pickup
      );
    END IF;
  END IF;

  IF v_plan IS NULL THEN
    v_plan := '{}'::jsonb;
  ELSIF NULLIF(trim(COALESCE(v_plan->>'name', '')), '') IS NULL
        AND p.service_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = p.service_id;
    IF v_service_name IS NOT NULL THEN
      v_plan := v_plan || jsonb_build_object('id', p.service_id, 'name', v_service_name);
    END IF;
  END IF;

  IF p.booking_id IS NOT NULL THEN
    SELECT status, plan
      INTO v_existing_status, v_existing_plan
      FROM public.bookings
     WHERE id = p.booking_id;

    IF FOUND AND public.booking_status_is_converted(v_existing_status) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', true,
        'reason', 'already_converted',
        'booking_id', p.booking_id,
        'converted_booking_id', p.booking_id,
        'already_existed', true,
        'status', v_existing_status
      );
    END IF;

    IF FOUND
       AND lower(COALESCE(v_existing_status, '')) IN ('pending_payment', 'booking_not_finished')
    THEN
      IF (
           v_existing_plan IS NULL
           OR jsonb_typeof(v_existing_plan) = 'null'
           OR v_existing_plan = '{}'::jsonb
           OR NULLIF(trim(COALESCE(v_existing_plan->>'name', '')), '') IS NULL
         )
         AND v_plan IS NOT NULL
         AND v_plan <> '{}'::jsonb
      THEN
        UPDATE public.bookings
        SET plan = v_plan
        WHERE id = p.booking_id;
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'booking_id', p.booking_id,
        'already_existed', true,
        'status', v_existing_status
      );
    END IF;

    UPDATE public.pending_customers
    SET booking_id = NULL
    WHERE id = p.id;

    p.booking_id := NULL;
  END IF;

  v_sibling := public.find_converted_checkout_sibling(
    p.email,
    NULL,
    p.drop_off_date,
    p.pickup_date
  );

  IF v_sibling IS NOT NULL THEN
    UPDATE public.pending_customers
    SET booking_id = v_sibling
    WHERE id = p.id;

    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_converted',
      'booking_id', v_sibling,
      'converted_booking_id', v_sibling,
      'already_existed', true,
      'status', 'converted'
    );
  END IF;

  v_delivery_type := CASE
    WHEN COALESCE(p.delivery_service, false)
      OR COALESCE((v_addons->>'isDelivery')::boolean, false)
      OR COALESCE((v_addons->>'deliveryService')::boolean, false)
      THEN 'delivery'
    WHEN COALESCE((v_plan->>'customer_pickup')::boolean, false)
      OR COALESCE((v_plan->>'id')::int, 0) = 2
      THEN 'self_service_trailer'
    ELSE 'self_pickup'
  END;

  v_name := NULLIF(trim(COALESCE(p.name, concat_ws(' ', p.first_name, p.last_name))), '');

  INSERT INTO public.bookings (
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
    subtotal_before_tax,
    tax_amount,
    delivery_type,
    status,
    notes,
    checkout_last_seen_at
  )
  VALUES (
    v_name,
    p.first_name,
    p.last_name,
    lower(trim(p.email)),
    p.phone,
    p.street,
    p.city,
    p.state,
    p.zip,
    p.contact_address,
    p.delivery_address,
    p.drop_off_date,
    p.pickup_date,
    p.drop_off_time_slot,
    p.pickup_time_slot,
    v_plan,
    v_addons || jsonb_build_object('equipment_hold_active', false),
    COALESCE(p.total_price, 0)::real,
    COALESCE(p.subtotal_before_tax, 0),
    0,
    v_delivery_type,
    'booking_not_finished',
    p.notes,
    COALESCE(p.last_seen_at, timezone('utc', now()))
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.pending_customers
  SET booking_id = v_booking_id
  WHERE id = p.id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'already_existed', false,
    'status', 'booking_not_finished'
  );
END;
$$;


ALTER FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint DEFAULT NULL::bigint, "p_booking_id" bigint DEFAULT NULL::bigint, "p_customer_id" bigint DEFAULT NULL::bigint, "p_email" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_token text;
  v_email text;
  v_customer_id bigint;
  v_booking_id bigint;
  v_ac_id bigint;
BEGIN
  v_ac_id := p_abandoned_checkout_id;
  v_booking_id := p_booking_id;
  v_customer_id := p_customer_id;
  v_email := lower(trim(COALESCE(p_email, '')));

  IF v_ac_id IS NOT NULL AND (v_email = '' OR v_booking_id IS NULL) THEN
    SELECT
      lower(trim(ac.email)),
      ac.booking_id
    INTO v_email, v_booking_id
    FROM public.abandoned_checkouts ac
    WHERE ac.id = v_ac_id;
  END IF;

  IF v_booking_id IS NOT NULL AND (v_email = '' OR v_customer_id IS NULL) THEN
    SELECT
      lower(trim(b.email)),
      b.customer_id
    INTO v_email, v_customer_id
    FROM public.bookings b
    WHERE b.id = v_booking_id;
  END IF;

  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'email required for unsubscribe token';
  END IF;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.unsubscribe_tokens (
    token, abandoned_checkout_id, booking_id, customer_id, email, expires_at
  )
  VALUES (
    v_token,
    v_ac_id,
    v_booking_id,
    v_customer_id,
    v_email,
    timezone('utc', now()) + interval '365 days'
  );

  RETURN v_token;
END;
$$;


ALTER FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint, "p_booking_id" bigint, "p_customer_id" bigint, "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_customer_id"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_customer_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."customer_owns_booking"("p_booking_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.id = p_booking_id
      AND c.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."customer_owns_booking"("p_booking_id" bigint) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text" DEFAULT 'left_early'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  rec record;
  eq jsonb;
  items jsonb := '[]'::jsonb;
  eq_id bigint;
  qty int;
  should_restock boolean := false;
  did_restock boolean := false;
  v_reason text;
  v_crm_id bigint;
  v_notes text;
  already_done boolean := false;
  v_sibling bigint;
  v_crm_status text;
BEGIN
  v_reason := lower(COALESCE(NULLIF(trim(p_reason), ''), 'left_early'));
  IF v_reason NOT IN ('left_early', 'reminded', 'expired', 'converted') THEN
    v_reason := 'left_early';
  END IF;

  SELECT id, status, addons, created_at, total_price, email, drop_off_date, pickup_date
    INTO rec
    FROM public.bookings
   WHERE id = p_booking_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  IF public.booking_status_is_converted(rec.status) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'skip_email', true,
      'skipped_reason', 'already_converted',
      'booking_id', rec.id,
      'converted_booking_id', rec.id,
      'restocked', false
    );
  END IF;

  v_sibling := public.find_converted_checkout_sibling(
    rec.email,
    rec.id,
    rec.drop_off_date,
    rec.pickup_date
  );

  IF lower(COALESCE(rec.status, '')) = 'booking_not_finished' THEN
    already_done := true;
    v_crm_status := CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END;
    v_crm_id := public.upsert_abandoned_checkout_from_booking(
      rec.id,
      v_crm_status,
      v_reason = 'reminded' AND v_sibling IS NULL
    );
    RETURN jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'booking_id', rec.id,
      'reason', v_crm_status,
      'restocked', false,
      'skip_email', v_sibling IS NOT NULL,
      'skipped_reason', CASE WHEN v_sibling IS NOT NULL THEN 'already_converted' ELSE NULL END,
      'converted_booking_id', v_sibling,
      'abandoned_checkout_id', v_crm_id
    );
  END IF;

  IF lower(COALESCE(rec.status, '')) IS DISTINCT FROM 'pending_payment' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_pending_payment',
      'status', rec.status,
      'skip_email', true
    );
  END IF;

  -- Restock only when this hold is unique — never when a paid sibling owns the dates.
  IF v_sibling IS NULL
     AND rec.addons IS NOT NULL
     AND jsonb_typeof(rec.addons->'equipment') = 'array'
     AND jsonb_array_length(rec.addons->'equipment') > 0
  THEN
    IF COALESCE(rec.addons->>'equipment_hold_active', '') IS DISTINCT FROM 'false' THEN
      should_restock := true;
    END IF;

    IF should_restock THEN
      FOR eq IN SELECT * FROM jsonb_array_elements(rec.addons->'equipment')
      LOOP
        eq_id := NULLIF(COALESCE(eq->>'dbId', eq->>'equipment_id', eq->>'id'), '')::bigint;
        qty := COALESCE(NULLIF(eq->>'quantity', '')::int, 1);
        IF eq_id IS NOT NULL AND qty > 0 THEN
          items := items || jsonb_build_array(
            jsonb_build_object('equipment_id', eq_id, 'quantity', qty)
          );
        END IF;
      END LOOP;

      IF jsonb_array_length(items) > 0 THEN
        PERFORM public.increment_equipment_quantities(items);
        did_restock := true;
      END IF;
    END IF;
  END IF;

  v_notes := CASE
    WHEN v_sibling IS NOT NULL THEN 'Superseded by paid booking in another tab'
    WHEN v_reason = 'reminded' THEN 'Idle checkout — reminded (no response to still-here prompt)'
    WHEN v_reason = 'expired' THEN 'Idle checkout — expired (30 minute ceiling)'
    ELSE 'Customer left booking before payment completed'
  END;

  UPDATE public.bookings
  SET
    status = 'booking_not_finished',
    addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false),
    archive_details = jsonb_build_object(
      'action', 'booking_not_finished',
      'action_at', now(),
      'initiated_by', CASE WHEN v_reason = 'left_early' AND v_sibling IS NULL THEN 'customer' ELSE 'system' END,
      'notes', v_notes,
      'reason', CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END,
      'original_created_at', rec.created_at,
      'original_total_price', rec.total_price,
      'converted_booking_id', v_sibling
    )
  WHERE id = rec.id
    AND status = 'pending_payment';

  IF NOT FOUND AND NOT already_done THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_race');
  END IF;

  v_crm_status := CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END;
  v_crm_id := public.upsert_abandoned_checkout_from_booking(
    rec.id,
    v_crm_status,
    v_reason = 'reminded' AND v_sibling IS NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', rec.id,
    'reason', v_crm_status,
    'restocked', did_restock,
    'skip_email', v_sibling IS NOT NULL,
    'skipped_reason', CASE WHEN v_sibling IS NOT NULL THEN 'already_converted' ELSE NULL END,
    'converted_booking_id', v_sibling,
    'abandoned_checkout_id', v_crm_id
  );
END;
$$;


ALTER FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_converted_checkout_sibling"("p_email" "text", "p_exclude_booking_id" bigint DEFAULT NULL::bigint, "p_drop_off" "date" DEFAULT NULL::"date", "p_pickup" "date" DEFAULT NULL::"date") RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email text;
  v_id bigint;
  v_start date;
  v_end date;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  v_start := p_drop_off;
  v_end := COALESCE(p_pickup, p_drop_off);

  SELECT b.id
    INTO v_id
    FROM public.bookings b
   WHERE lower(trim(COALESCE(b.email, ''))) = v_email
     AND (p_exclude_booking_id IS NULL OR b.id IS DISTINCT FROM p_exclude_booking_id)
     AND public.booking_status_is_converted(b.status)
     AND (
       (
         v_start IS NOT NULL
         AND b.drop_off_date IS NOT NULL
         AND daterange(
           b.drop_off_date,
           COALESCE(b.pickup_date, b.drop_off_date),
           '[]'
         ) && daterange(v_start, v_end, '[]')
       )
       OR (
         v_start IS NULL
         AND b.created_at > (timezone('utc', now()) - interval '24 hours')
       )
     )
   ORDER BY b.id DESC
   LIMIT 1;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."find_converted_checkout_sibling"("p_email" "text", "p_exclude_booking_id" bigint, "p_drop_off" "date", "p_pickup" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval DEFAULT '00:31:00'::interval) RETURNS TABLE("booking_id" bigint, "pending_id" "uuid", "source" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id AS booking_id,
    NULL::uuid AS pending_id,
    'booking'::text AS source
  FROM public.bookings b
  WHERE b.status = 'pending_payment'
    AND COALESCE(b.checkout_last_seen_at, b.created_at) < now() - p_stale_after
  ORDER BY b.id;

  RETURN QUERY
  SELECT
    NULL::bigint AS booking_id,
    pc.id AS pending_id,
    'pending'::text AS source
  FROM public.pending_customers pc
  WHERE pc.booking_id IS NULL
    AND COALESCE(pc.last_seen_at, pc.created_at) < now() - p_stale_after
    AND COALESCE(pc.email, '') <> ''
    AND public.find_converted_checkout_sibling(
      pc.email,
      NULL,
      pc.drop_off_date,
      pc.pickup_date
    ) IS NULL
  ORDER BY pc.created_at;
END;
$$;


ALTER FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_booking_for_post_checkout"("p_booking_id" bigint, "p_payment_intent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_customer jsonb;
BEGIN
  IF p_payment_intent IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.stripe_payment_info spi
    WHERE spi.booking_id = p_booking_id
      AND (
        spi.stripe_payment_intent_id = p_payment_intent
        OR spi.stripe_checkout_session_id = p_payment_intent
      )
  ) THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stripe_payment_info spi WHERE spi.booking_id = p_booking_id
  ) THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
    AND status = 'pending_payment'
    AND created_at > (now() - interval '7 days');

  IF FOUND THEN
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  RAISE EXCEPTION 'Not authorized';
END;
$$;


ALTER FUNCTION "public"."get_booking_for_post_checkout"("p_booking_id" bigint, "p_payment_intent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  p record;
  v_status text;
  v_converted_id bigint;
  v_email text;
  v_verified boolean;
  v_progress jsonb;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT id, email, booking_id, drop_off_date, pickup_date, is_verified, verified_at
    INTO p
    FROM public.pending_customers
   WHERE id = p_pending_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found', 'completed', false);
  END IF;

  v_email := lower(trim(COALESCE(p.email, '')));
  v_verified := COALESCE(p.is_verified, false);

  v_progress := jsonb_build_object(
    'email', v_email,
    'email_verified', v_verified,
    'verified_at', p.verified_at
  );

  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND AND public.booking_status_is_converted(v_status) THEN
      RETURN v_progress || jsonb_build_object(
        'ok', true,
        'completed', true,
        'booking_id', p.booking_id,
        'status', v_status,
        'reason', 'linked_booking'
      );
    END IF;
  END IF;

  v_converted_id := public.find_converted_checkout_sibling(
    p.email,
    p.booking_id,
    p.drop_off_date,
    p.pickup_date
  );

  IF v_converted_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = v_converted_id;
    RETURN v_progress || jsonb_build_object(
      'ok', true,
      'completed', true,
      'booking_id', v_converted_id,
      'status', v_status,
      'reason', 'sibling_converted'
    );
  END IF;

  RETURN v_progress || jsonb_build_object(
    'ok', true,
    'completed', false,
    'booking_id', p.booking_id,
    'status', v_status
  );
END;
$$;


ALTER FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") IS 'Checkout progress for a pending id: completed/booking_id plus email_verified from pending_customers.is_verified only (not lifetime email_verifications).';



CREATE OR REPLACE FUNCTION "public"."get_checkout_verification_documents"("p_customer_id" bigint, "p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email text;
  v_customer record;
  v_doc record;
  v_legacy_front text;
  v_legacy_back text;
  v_legacy_front_path text;
  v_legacy_back_path text;
  v_result jsonb;
BEGIN
  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email = '' OR p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, email, license_plate, license_image_urls
  INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND lower(email) = v_email;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_doc
  FROM public.driver_verification_documents
  WHERE customer_id = p_customer_id;

  IF jsonb_typeof(v_customer.license_image_urls) = 'array' AND jsonb_array_length(v_customer.license_image_urls) > 0 THEN
    v_legacy_front := v_customer.license_image_urls->0->>'url';
    v_legacy_front_path := v_customer.license_image_urls->0->>'path';
  END IF;

  IF jsonb_typeof(v_customer.license_image_urls) = 'array' AND jsonb_array_length(v_customer.license_image_urls) > 1 THEN
    v_legacy_back := v_customer.license_image_urls->1->>'url';
    v_legacy_back_path := v_customer.license_image_urls->1->>'path';
  END IF;

  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'license_plate', v_customer.license_plate,
    'license_front_url', COALESCE(v_doc.license_front_url, v_legacy_front),
    'license_front_storage_path', COALESCE(v_doc.license_front_storage_path, v_legacy_front_path),
    'license_back_url', COALESCE(v_doc.license_back_url, v_legacy_back),
    'license_back_storage_path', COALESCE(v_doc.license_back_storage_path, v_legacy_back_path),
    'insurance_url', v_doc.insurance_url,
    'insurance_storage_path', v_doc.insurance_storage_path,
    'verification_status', COALESCE(v_doc.verification_status, CASE WHEN v_legacy_front IS NOT NULL THEN 'legacy' ELSE NULL END)
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_checkout_verification_documents"("p_customer_id" bigint, "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_feedback_chat_messages"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  gate jsonb;
  msgs jsonb;
BEGIN
  gate := public._feedback_chat_token_or_error(p_token);
  IF COALESCE((gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN gate;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'sender_type', m.sender_type,
      'message_content', m.message_content,
      'message_severity', m.message_severity,
      'message_context', m.message_context,
      'created_at', m.created_at
    )
    ORDER BY m.created_at ASC, m.id ASC
  ), '[]'::jsonb)
  INTO msgs
  FROM public.chat_messages m
  WHERE m.conversation_id = gate->>'conversation_id'
    AND m.created_at >= (gate->>'used_at')::timestamptz
    AND (
      COALESCE(m.message_context->>'type', '') = 'how_can_we_do_better'
      OR COALESCE(m.message_severity, '') IS DISTINCT FROM 'info'
    );

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'chat',
    'chat_expires_at', gate->>'chat_expires_at',
    'messages', msgs,
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
        'name', c.name,
        'email', c.email
      )
      FROM public.customers c
      WHERE c.id = (gate->>'customer_id')::bigint
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_feedback_chat_messages"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_feedback_form_by_token"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  t record;
  questions jsonb;
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT * INTO t FROM public.feedback_tokens WHERE token = p_token;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NOT NULL THEN
    IF t.chat_closed_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This feedback conversation is closed. You can still reach us on the Contact page.',
        'mode', 'closed'
      );
    END IF;

    IF t.chat_expires_at IS NULL OR t.chat_expires_at < v_now THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This feedback conversation link has expired. You can still reach us on the Contact page.',
        'mode', 'expired'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'chat',
      'chat_expires_at', t.chat_expires_at,
      'booking_id', t.booking_id,
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id,
          'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
          'name', c.name,
          'email', c.email
        )
        FROM public.customers c
        WHERE c.id = t.customer_id
      )
    );
  END IF;

  IF t.expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link has expired');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'prompt', q.prompt,
      'field_key', q.field_key,
      'input_type', q.input_type,
      'options', q.options,
      'is_required', q.is_required,
      'sort_order', q.sort_order
    )
    ORDER BY q.sort_order, q.id
  ), '[]'::jsonb)
  INTO questions
  FROM public.feedback_questions q
  WHERE q.is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'form',
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
        'name', c.name,
        'email', c.email
      )
      FROM public.customers c
      WHERE c.id = t.customer_id
    ),
    'booking_id', t.booking_id,
    'questions', questions
  );
END;
$$;


ALTER FUNCTION "public"."get_feedback_form_by_token"("p_token" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "phone" "text",
    "street" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_verified" boolean DEFAULT false,
    "booking_id" bigint,
    "service_id" integer,
    "plan_data" "jsonb",
    "total_price" numeric(10,2),
    "base_price" numeric(10,2),
    "drop_off_date" "date",
    "pickup_date" "date",
    "drop_off_time_slot" "text",
    "pickup_time_slot" "text",
    "addons_data" "jsonb",
    "booking_data" "jsonb",
    "delivery_service" boolean DEFAULT false,
    "verified_at" timestamp with time zone,
    "first_name" "text",
    "last_name" "text",
    "contact_address" "jsonb",
    "delivery_address" "jsonb",
    "notes" "text",
    "subtotal_before_tax" numeric,
    "drop_off_window_start" time without time zone,
    "drop_off_window_end" time without time zone,
    "pickup_window_start" time without time zone,
    "pickup_window_end" time without time zone,
    "last_seen_at" timestamp with time zone
);


ALTER TABLE "public"."pending_customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pending_customers"."last_seen_at" IS 'Last client heartbeat while pending checkout (pre-payment) is in progress.';



CREATE OR REPLACE FUNCTION "public"."get_pending_customer_by_id"("p_id" "uuid") RETURNS SETOF "public"."pending_customers"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT *
  FROM public.pending_customers
  WHERE id = p_id;
$$;


ALTER FUNCTION "public"."get_pending_customer_by_id"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_booking_completed_referral_activation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'completed'
     AND lower(COALESCE(OLD.status, '')) <> 'completed'
  THEN
    PERFORM public.activate_referral_for_completed_booking(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_booking_completed_referral_activation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_contact_form"("contact_name" "text", "contact_email" "text", "contact_message" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  customer_id_var bigint;
  email_clean text := lower(trim(COALESCE(contact_email, '')));
  name_clean text := trim(COALESCE(contact_name, ''));
  message_clean text := trim(COALESCE(contact_message, ''));
  has_paid_booking boolean := false;
  note_body text;
BEGIN
  IF email_clean = '' OR message_clean = '' THEN
    RAISE EXCEPTION 'Email and message are required';
  END IF;

  SELECT c.id
    INTO customer_id_var
  FROM public.customers c
  WHERE lower(trim(c.email)) = email_clean
  ORDER BY c.id
  LIMIT 1;

  IF customer_id_var IS NULL THEN
    INSERT INTO public.customers (name, email, segment)
    VALUES (
      COALESCE(NULLIF(name_clean, ''), email_clean),
      email_clean,
      'feedback_lead'
    )
    RETURNING id INTO customer_id_var;
  ELSE
    -- Refresh name if blank
    UPDATE public.customers
    SET
      name = CASE
        WHEN COALESCE(trim(name), '') = '' AND name_clean <> '' THEN name_clean
        ELSE name
      END,
      email = CASE
        WHEN lower(trim(email)) <> email_clean THEN email_clean
        ELSE email
      END
    WHERE id = customer_id_var;

    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.customer_id = customer_id_var
        AND b.status IS NOT NULL
        AND lower(COALESCE(b.status, '')) NOT IN (
          'pending_payment',
          'cancelled',
          'canceled'
        )
    ) INTO has_paid_booking;

    -- Contact-only / unpaid leads belong under How can we do better
    IF NOT has_paid_booking THEN
      UPDATE public.customers
      SET segment = 'feedback_lead'
      WHERE id = customer_id_var
        AND segment IS DISTINCT FROM 'feedback_lead';
    END IF;
  END IF;

  note_body := format(
    E'Contact form inquiry from %s <%s>:\n\n%s',
    COALESCE(NULLIF(name_clean, ''), 'Unknown'),
    email_clean,
    message_clean
  );

  INSERT INTO public.customer_notes (
    customer_id,
    source,
    content,
    author_type,
    is_read
  )
  VALUES (
    customer_id_var,
    'Contact Form Inquiry',
    note_body,
    'customer',
    false
  );

  -- Belt-and-suspenders with handle_new_note trigger
  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = customer_id_var;
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

  IF incoming_status IS DISTINCT FROM 'booking_not_finished' THEN
    NEW.status := 'pending_payment';
  ELSE
    NEW.status := 'booking_not_finished';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_booking"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_booking"() IS 'BEFORE INSERT trigger on bookings. Upserts the customer row atomically instead of SELECT-then-branch, so concurrent checkouts sharing an email cannot race into a unique constraint violation. Accepts verificationSkipped or wasVerificationSkipped in addons.';



CREATE OR REPLACE FUNCTION "public"."handle_new_note"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.author_type = 'customer' AND COALESCE(NEW.is_read, false) = false THEN
    UPDATE public.customers
       SET has_unread_notes = TRUE
     WHERE id = NEW.customer_id;
  END IF;
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
  SELECT
    coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', 'false')::boolean
    AND coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
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

    -- Handle Insurance Document Changes
    IF TG_OP = 'INSERT' AND NEW.insurance_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'insurance_document', NEW.insurance_storage_path, NEW.insurance_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.insurance_url IS DISTINCT FROM OLD.insurance_url AND NEW.insurance_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'insurance_document', NEW.insurance_storage_path, NEW.insurance_url, 'replaced', NEW.verified_by);
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_verification_image_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_booking_delivery_verified"("p_booking_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.bookings
  SET
    delivery_location_verified = true,
    delivery_location_verified_at = now()
  WHERE id = p_booking_id
    AND status = 'pending_payment';
END;
$$;


ALTER FUNCTION "public"."mark_booking_delivery_verified"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_customer_feedback_lead"("p_customer_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.customer_id = p_customer_id
      AND lower(COALESCE(b.status, '')) NOT IN (
        'pending_payment',
        'cancelled',
        'canceled',
        'booking_not_finished'
      )
  ) THEN
    UPDATE public.customers SET segment = 'booked' WHERE id = p_customer_id;
    RETURN;
  END IF;

  UPDATE public.customers
  SET segment = 'feedback_lead'
  WHERE id = p_customer_id;
END;
$$;


ALTER FUNCTION "public"."mark_customer_feedback_lead"("p_customer_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_booking_time_windows"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_service_id integer;
  v_span       integer;
  v_window     record;
begin
  if tg_table_name = 'pending_customers' then
    v_service_id := public.resolve_service_id_for_delivery(new.service_id, new.delivery_service);
  else
    v_service_id := public.resolve_booking_service_id(new.plan, new.addons);
  end if;

  v_span := coalesce(public.service_slot_span_minutes(v_service_id), 120);

  if new.drop_off_window_start is null
     or (tg_op = 'UPDATE'
         and new.drop_off_time_slot is distinct from old.drop_off_time_slot
         and new.drop_off_window_start is not distinct from old.drop_off_window_start)
  then
    select w.window_start, w.window_end
      into v_window
      from public.parse_booking_time_slot(new.drop_off_time_slot, v_span) w;
    new.drop_off_window_start := v_window.window_start;
    new.drop_off_window_end   := v_window.window_end;
  end if;

  if new.pickup_window_start is null
     or (tg_op = 'UPDATE'
         and new.pickup_time_slot is distinct from old.pickup_time_slot
         and new.pickup_window_start is not distinct from old.pickup_window_start)
  then
    select w.window_start, w.window_end
      into v_window
      from public.parse_booking_time_slot(new.pickup_time_slot, v_span) w;
    new.pickup_window_start := v_window.window_start;
    new.pickup_window_end   := v_window.window_end;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_booking_time_windows"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_feedback_chat_admin_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'vault'
    AS $$
DECLARE
  t record;
  v_url text;
  v_key text;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.message_context->>'type', '') = 'how_can_we_do_better' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.message_severity, '') = 'info'
     AND COALESCE(NEW.message_context->>'type', '') <> 'feedback_public_chat' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO t
  FROM public.feedback_tokens
  WHERE customer_id = NEW.customer_id
    AND used_at IS NOT NULL
    AND chat_closed_at IS NULL
    AND chat_expires_at IS NOT NULL
    AND chat_expires_at > timezone('utc', now())
  ORDER BY used_at DESC
  LIMIT 1;

  IF t.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF t.last_chat_reply_email_at IS NOT NULL
     AND t.last_chat_reply_email_at > timezone('utc', now()) - interval '2 minutes' THEN
    RETURN NEW;
  END IF;

  UPDATE public.feedback_tokens
  SET last_chat_reply_email_at = timezone('utc', now())
  WHERE id = t.id;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE WARNING '[notify_feedback_chat_admin_reply] missing vault secrets';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/notify-feedback-chat-reply',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'token_id', t.id,
        'customer_id', t.customer_id,
        'message_id', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_feedback_chat_admin_reply] http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_feedback_chat_admin_reply"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer DEFAULT 120) RETURNS TABLE("window_start" time without time zone, "window_end" time without time zone)
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
declare
  v_raw   text;
  v_start time;
  v_end   time;
  v_span  integer;
begin
  v_raw := btrim(coalesce(p_slot, ''));
  if v_raw = '' then
    return;
  end if;

  if position('|' in v_raw) > 0 then
    v_start := public.parse_clock_time(split_part(v_raw, '|', 1));
    v_end   := public.parse_clock_time(split_part(v_raw, '|', 2));
    if v_start is null or v_end is null then
      return;
    end if;
  else
    v_start := public.parse_clock_time(v_raw);
    if v_start is null then
      return;
    end if;
    v_span := greatest(coalesce(p_span_minutes, 0), 0);
    v_end := v_start + make_interval(mins => v_span);
    -- A late slot plus its span can wrap past midnight, which would leave end < start and
    -- break every overlap test. Clamp to the end of the day instead.
    if v_span > 0 and v_end <= v_start then
      v_end := time '23:59:59';
    end if;
  end if;

  return query select v_start, v_end;
end;
$$;


ALTER FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer) IS 'Normalises any stored booking time slot format into a (start, end) window. No rows when unparseable.';



CREATE OR REPLACE FUNCTION "public"."parse_clock_time"("p_value" "text") RETURNS time without time zone
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $_$
declare
  v_raw   text;
  v_parts text[];
  v_hour  integer;
begin
  v_raw := upper(btrim(coalesce(p_value, '')));
  if v_raw = '' then
    return null;
  end if;

  v_parts := regexp_match(v_raw, '^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$');
  if v_parts is not null then
    v_hour := (v_parts[1])::integer % 12;
    if v_parts[4] = 'PM' then
      v_hour := v_hour + 12;
    end if;
    return make_time(v_hour, (v_parts[2])::integer, coalesce((v_parts[3])::integer, 0));
  end if;

  v_parts := regexp_match(v_raw, '^(\d{1,2}):(\d{2})(?::(\d{2}))?$');
  if v_parts is not null then
    v_hour := (v_parts[1])::integer;
    if v_hour > 23 then
      return null;
    end if;
    return make_time(v_hour, (v_parts[2])::integer, coalesce((v_parts[3])::integer, 0));
  end if;

  return null;
end;
$_$;


ALTER FUNCTION "public"."parse_clock_time"("p_value" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."parse_clock_time"("p_value" "text") IS 'Parses HH:mm, HH:mm:ss and h:mm AM/PM into time. Returns null for anything unrecognised.';



CREATE OR REPLACE FUNCTION "public"."post_feedback_chat_message"("p_token" "text", "p_body" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  gate jsonb;
  body_clean text := trim(COALESCE(p_body, ''));
  recent_count int;
  new_id uuid;
BEGIN
  gate := public._feedback_chat_token_or_error(p_token);
  IF COALESCE((gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN gate;
  END IF;

  IF body_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message cannot be empty');
  END IF;

  IF char_length(body_clean) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message is too long (max 4000 characters)');
  END IF;

  SELECT COUNT(*)::int INTO recent_count
  FROM public.chat_messages m
  WHERE m.conversation_id = gate->>'conversation_id'
    AND m.sender_type = 'customer'
    AND m.created_at >= timezone('utc', now()) - interval '1 hour';

  IF recent_count >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Too many messages. Please wait a bit and try again.');
  END IF;

  INSERT INTO public.chat_messages (
    conversation_id, customer_id, booking_id, sender_type, message_content, is_read, message_context
  )
  VALUES (
    gate->>'conversation_id',
    (gate->>'customer_id')::bigint,
    NULLIF(gate->>'booking_id', '')::bigint,
    'customer',
    body_clean,
    false,
    jsonb_build_object('type', 'feedback_public_chat', 'feedback_token_id', (gate->>'token_id')::bigint)
  )
  RETURNING id INTO new_id;

  UPDATE public.customers SET has_unread_notes = true WHERE id = (gate->>'customer_id')::bigint;

  RETURN jsonb_build_object('ok', true, 'message_id', new_id);
END;
$$;


ALTER FUNCTION "public"."post_feedback_chat_message"("p_token" "text", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_unsubscribe"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  t record;
  ac record;
  v_customer_id bigint;
  v_booking_id bigint;
  v_email text;
  v_has_paid boolean := false;
  v_deleted_booking boolean := false;
  v_deleted_customer boolean := false;
  v_deleted_pending int := 0;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO t
  FROM public.unsubscribe_tokens
  WHERE token = trim(p_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true);
  END IF;

  IF t.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired_token');
  END IF;

  v_email := lower(trim(t.email));
  v_booking_id := t.booking_id;
  v_customer_id := t.customer_id;

  -- Prefer abandoned_checkout linkage
  IF t.abandoned_checkout_id IS NOT NULL THEN
    SELECT * INTO ac FROM public.abandoned_checkouts WHERE id = t.abandoned_checkout_id;
    IF FOUND THEN
      v_booking_id := COALESCE(v_booking_id, ac.booking_id);
      v_email := COALESCE(NULLIF(v_email, ''), lower(trim(ac.email)));
      UPDATE public.abandoned_checkouts
      SET
        status = 'unsubscribed',
        marketing_eligible = false,
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('unsubscribed_at', now())
      WHERE id = ac.id;
    END IF;
  ELSIF v_booking_id IS NOT NULL THEN
    PERFORM public.upsert_abandoned_checkout_from_booking(v_booking_id, 'unsubscribed', false);
    UPDATE public.abandoned_checkouts
    SET marketing_eligible = false, status = 'unsubscribed', updated_at = now()
    WHERE booking_id = v_booking_id;
  END IF;

  -- Also mark any other abandoned_checkouts for this email
  UPDATE public.abandoned_checkouts
  SET
    status = 'unsubscribed',
    marketing_eligible = false,
    updated_at = now()
  WHERE lower(trim(email)) = v_email
    AND status IS DISTINCT FROM 'unsubscribed';

  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE lower(trim(email)) = v_email LIMIT 1;
  END IF;

  -- Delete unfinished booking only (never paid history)
  IF v_booking_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = v_booking_id
        AND lower(COALESCE(b.status, '')) IN (
          'booking_not_finished',
          'pending_payment',
          'cancelled',
          'canceled'
        )
    ) THEN
      -- Clear FKs that may block delete
      UPDATE public.pending_customers SET booking_id = NULL WHERE booking_id = v_booking_id;
      UPDATE public.unsubscribe_tokens SET booking_id = NULL WHERE booking_id = v_booking_id;
      IF to_regclass('public.magic_link_tokens') IS NOT NULL THEN
        EXECUTE 'UPDATE public.magic_link_tokens SET order_id = NULL WHERE order_id = $1'
          USING v_booking_id;
      END IF;
      DELETE FROM public.feedback_tokens WHERE booking_id = v_booking_id;
      DELETE FROM public.feedback_responses WHERE booking_id = v_booking_id;
      BEGIN
        DELETE FROM public.bookings WHERE id = v_booking_id;
        v_deleted_booking := true;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Keep CRM row; leave booking but ensure it is not active
        UPDATE public.bookings
        SET status = 'booking_not_finished',
            addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false)
        WHERE id = v_booking_id;
        v_deleted_booking := false;
      END;
    END IF;
  END IF;

  -- Remove pending checkout drafts for this email
  DELETE FROM public.pending_customers
  WHERE lower(trim(email)) = v_email;
  GET DIAGNOSTICS v_deleted_pending = ROW_COUNT;

  -- Delete feedback for this customer if they only ever abandoned
  IF v_customer_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = v_customer_id
        AND lower(COALESCE(b.status, '')) NOT IN (
          'pending_payment',
          'cancelled',
          'canceled',
          'booking_not_finished'
        )
    ) INTO v_has_paid;

    IF NOT v_has_paid THEN
      DELETE FROM public.feedback_responses WHERE customer_id = v_customer_id;
      DELETE FROM public.feedback_tokens WHERE customer_id = v_customer_id;
      DELETE FROM public.customers WHERE id = v_customer_id;
      v_deleted_customer := true;
    END IF;
  END IF;

  UPDATE public.unsubscribe_tokens
  SET used_at = timezone('utc', now())
  WHERE id = t.id;

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_email,
    'deleted_booking', v_deleted_booking,
    'deleted_customer', v_deleted_customer,
    'deleted_pending_count', v_deleted_pending
  );
END;
$_$;


ALTER FUNCTION "public"."process_unsubscribe"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_customer_segment_on_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND lower(COALESCE(NEW.status, '')) NOT IN (
       'pending_payment',
       'cancelled',
       'canceled',
       'booking_not_finished'
     )
  THEN
    UPDATE public.customers
    SET segment = 'booked'
    WHERE id = NEW.customer_id
      AND segment IS DISTINCT FROM 'booked';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."promote_customer_segment_on_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.booking_protection_plans
     SET cancelled_at = NULL,
         cancellation_reason = NULL
   WHERE booking_id = p_booking_id
     AND cancelled_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_dollars" numeric DEFAULT NULL::numeric) RETURNS TABLE("referral_id" bigint, "pending_recorded" boolean, "already_rewarded" boolean, "blocked_duplicate" boolean, "referrer_customer_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_bonus numeric(10,2);
  v_wallet_result record;
BEGIN
  IF p_booking_id IS NULL OR p_referee_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;
  referrer_customer_id := v_referral.referrer_customer_id;

  IF v_referral.referrer_customer_id = p_referee_customer_id THEN
    blocked_duplicate := true;
    pending_recorded := false;
    already_rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.referrals r
     WHERE r.referee_customer_id = p_referee_customer_id
       AND r.id <> v_referral.id
       AND r.status IN ('pending_completion', 'pending_activation', 'completed', 'rewarded')
  ) THEN
    blocked_duplicate := true;
    pending_recorded := false;
    already_rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_bonus := round(COALESCE(p_bonus_dollars, (
    SELECT ls.referral_bonus_dollars
      FROM public.loyalty_settings ls
     ORDER BY ls.id DESC
     LIMIT 1
  ), 25), 2);

  UPDATE public.referrals
     SET referee_customer_id = COALESCE(referee_customer_id, p_referee_customer_id),
         pending_booking_id = COALESCE(pending_booking_id, p_booking_id),
         status = CASE
           WHEN status = 'rewarded' THEN status
           ELSE 'pending_completion'
         END
   WHERE id = v_referral.id
   RETURNING * INTO v_referral;

  already_rewarded := v_referral.status = 'rewarded';
  blocked_duplicate := false;
  pending_recorded := false;

  IF NOT already_rewarded AND v_bonus > 0 THEN
    SELECT *
      INTO v_wallet_result
      FROM public.adjust_referral_wallet(
        v_referral.referrer_customer_id,
        v_bonus,
        'pending_accrual',
        p_booking_id,
        v_referral.id,
        'Referral pending until booking #' || p_booking_id::text || ' reaches Completed'
      );

    pending_recorded := NOT COALESCE(v_wallet_result.already_processed, false);

    UPDATE public.referrals
       SET referrer_bonus_dollars_awarded = GREATEST(COALESCE(referrer_bonus_dollars_awarded, 0), v_bonus)
     WHERE id = v_referral.id;
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."register_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_dollars" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    AS $_$
declare
  v_plan_id_text text;
  v_is_delivery  boolean;
begin
  v_plan_id_text := coalesce(p_plan, '{}'::jsonb) ->> 'id';
  if v_plan_id_text is null or v_plan_id_text !~ '^\d+$' then
    return null;
  end if;

  v_is_delivery := coalesce(
    case
      when jsonb_typeof(coalesce(p_addons, '{}'::jsonb) -> 'isDelivery') = 'boolean'
        then (p_addons -> 'isDelivery')::boolean
      when lower(coalesce(p_addons, '{}'::jsonb) ->> 'isDelivery') in ('true', '1')
        then true
      else false
    end,
    false
  );

  return public.resolve_service_id_for_delivery(v_plan_id_text::integer, v_is_delivery);
end;
$_$;


ALTER FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") IS 'Service id whose inventory_rules a booking consumes, following delivery_variant_service_id when the customer chose delivery.';



CREATE OR REPLACE FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select case
           when p_service_id is null then null
           when coalesce(p_is_delivery, false) then coalesce(
             (select s.delivery_variant_service_id from public.services s where s.id = p_service_id),
             p_service_id
           )
           else p_service_id
         end;
$$;


ALTER FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) IS 'Applies services.delivery_variant_service_id when a booking is for delivery.';



CREATE OR REPLACE FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone DEFAULT NULL::time without time zone, "p_slot_end" time without time zone DEFAULT NULL::time without time zone, "p_exclude_booking_id" bigint DEFAULT NULL::bigint) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(sum(r.quantity), 0)::integer
  from public.booking_resource_reservations r
  where r.resource_id = p_resource_id
    and r.reserved_date = p_date
    and (p_exclude_booking_id is null or r.booking_id <> p_exclude_booking_id)
    and (
      r.granularity = 'day'                                          -- a day reservation blocks any request
      or p_slot_start is null                                        -- a day request is blocked by any slot reservation
      or (r.slot_start < p_slot_end and r.slot_end > p_slot_start)    -- slot vs slot overlap
    );
$$;


ALTER FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone, "p_slot_end" time without time zone, "p_exclude_booking_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone, "p_slot_end" time without time zone, "p_exclude_booking_id" bigint) IS 'How much of a resource is already reserved for a date (p_slot_start null) or a specific time window. The one function both get-availability''s bulk read and the write-time trigger reason about, so read-time and write-time capacity cannot drift apart.';



CREATE OR REPLACE FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("already_processed" boolean, "points_reversed" integer, "new_balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_customer_id bigint;
  v_earned integer := 0;
  v_already_cancelled integer := 0;
  v_balance integer := 0;
  v_addons jsonb;
BEGIN
  -- Access control: GRANT EXECUTE TO service_role only (or postgres via trigger/migration).
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.customer_id, COALESCE(b.addons, '{}'::jsonb)
    INTO v_customer_id, v_addons
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking % not found or missing customer', p_booking_id;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_already_cancelled
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type = 'cancelled';

  IF v_already_cancelled > 0 THEN
    SELECT lp.points_balance INTO v_balance
      FROM public.loyalty_points lp
     WHERE lp.customer_id = v_customer_id;
    already_processed := true;
    points_reversed := 0;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE
             WHEN lt.transaction_type = 'earned' THEN lt.points_amount
             WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
             ELSE 0
           END
         ), 0)
    INTO v_earned
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type IN ('earned', 'reschedule_adjustment');

  IF v_earned <= 0 THEN
    v_earned := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
  END IF;

  IF v_earned <= 0 THEN
    already_processed := true;
    points_reversed := 0;
    SELECT lp.points_balance INTO v_balance
      FROM public.loyalty_points lp
     WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    UPDATE public.bookings
       SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
             'loyaltyPointsEarned', 0,
             'loyaltyPointsReversedOnCancel', 0
           )
     WHERE id = p_booking_id;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.loyalty_points (customer_id, points_balance, total_points_earned, total_points_redeemed)
  VALUES (v_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF COALESCE(v_balance, 0) < v_earned THEN
    v_earned := GREATEST(0, COALESCE(v_balance, 0));
  END IF;

  IF v_earned > 0 THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance - v_earned,
           total_points_earned = GREATEST(0, total_points_earned - v_earned),
           last_updated = now()
     WHERE customer_id = v_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      notes
    )
    VALUES (
      v_customer_id,
      'cancelled',
      v_earned,
      p_booking_id,
      COALESCE(p_reason, format('Cancelled booking #%s — loyalty points reversed', p_booking_id))
    );
  END IF;

  UPDATE public.bookings
     SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
           'loyaltyPointsEarned', 0,
           'loyaltyPointsReversedOnCancel', v_earned
         )
   WHERE id = p_booking_id;

  already_processed := false;
  points_reversed := v_earned;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) RETURNS integer
    LANGUAGE "sql" STABLE PARALLEL SAFE
    AS $$
  select case
           when s.service_type = 'hourly' then 0
           else coalesce(s.slot_interval_minutes, 120)
         end
    from public.services s
   where s.id = p_service_id;
$$;


ALTER FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) IS 'Minutes a single-valued time slot spans for a service; 0 when the slot is an instant, not a window.';



CREATE OR REPLACE FUNCTION "public"."set_abandoned_checkouts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_abandoned_checkouts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."store_pending_booking"("payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_email text;
  v_existing_id uuid;
  v_record_id uuid;
  v_drop_off_raw text;
  v_pickup_raw text;
  v_service_id_raw text;
  v_total_price_raw text;
  v_base_price_raw text;
  v_delivery_service_raw text;
  v_drop_off_date date;
  v_pickup_date date;
  v_service_id integer;
  v_total_price numeric;
  v_base_price numeric;
  v_delivery_service boolean;
  v_email_preverified boolean;
  v_mark_verified boolean;
BEGIN
  v_email := lower(trim(payload->>'email'));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  v_email_preverified := lower(coalesce(payload->>'email_preverified', 'false')) IN ('true', 't', '1', 'yes', 'y', 'on');
  v_mark_verified := false;

  IF v_email_preverified THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.email_verifications ev
      WHERE lower(ev.email) = v_email
        AND ev.is_verified = true
    ) INTO v_mark_verified;
  END IF;

  v_drop_off_raw := NULLIF(trim(payload->>'drop_off_date'), '');
  v_pickup_raw := NULLIF(trim(payload->>'pickup_date'), '');
  v_service_id_raw := NULLIF(trim(payload->>'service_id'), '');
  v_total_price_raw := NULLIF(trim(payload->>'total_price'), '');
  v_base_price_raw := NULLIF(trim(payload->>'base_price'), '');
  v_delivery_service_raw := NULLIF(trim(payload->>'delivery_service'), '');

  IF v_drop_off_raw IS NULL THEN
    v_drop_off_date := NULL;
  ELSE
    BEGIN
      v_drop_off_date := (substring(v_drop_off_raw from '^(\d{4}-\d{2}-\d{2})'))::date;
    EXCEPTION WHEN others THEN
      v_drop_off_date := NULL;
    END;
  END IF;

  IF v_pickup_raw IS NULL THEN
    v_pickup_date := NULL;
  ELSE
    BEGIN
      v_pickup_date := (substring(v_pickup_raw from '^(\d{4}-\d{2}-\d{2})'))::date;
    EXCEPTION WHEN others THEN
      v_pickup_date := NULL;
    END;
  END IF;

  IF v_service_id_raw IS NOT NULL AND v_service_id_raw ~ '^-?\d+$' THEN
    v_service_id := v_service_id_raw::integer;
  ELSE
    v_service_id := NULL;
  END IF;

  IF v_total_price_raw IS NOT NULL AND v_total_price_raw ~ '^-?\d+(\.\d+)?$' THEN
    v_total_price := v_total_price_raw::numeric;
  ELSE
    v_total_price := NULL;
  END IF;

  IF v_base_price_raw IS NOT NULL AND v_base_price_raw ~ '^-?\d+(\.\d+)?$' THEN
    v_base_price := v_base_price_raw::numeric;
  ELSE
    v_base_price := NULL;
  END IF;

  IF v_delivery_service_raw IS NULL THEN
    v_delivery_service := false;
  ELSE
    CASE lower(v_delivery_service_raw)
      WHEN 'true' THEN v_delivery_service := true;
      WHEN 't' THEN v_delivery_service := true;
      WHEN '1' THEN v_delivery_service := true;
      WHEN 'yes' THEN v_delivery_service := true;
      WHEN 'y' THEN v_delivery_service := true;
      WHEN 'on' THEN v_delivery_service := true;
      WHEN 'false' THEN v_delivery_service := false;
      WHEN 'f' THEN v_delivery_service := false;
      WHEN '0' THEN v_delivery_service := false;
      WHEN 'no' THEN v_delivery_service := false;
      WHEN 'n' THEN v_delivery_service := false;
      WHEN 'off' THEN v_delivery_service := false;
      ELSE v_delivery_service := false;
    END CASE;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.pending_customers
  WHERE lower(email) = v_email
  ORDER BY
    CASE WHEN email = v_email THEN 0 ELSE 1 END,
    created_at DESC,
    id DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET
      email = v_email,
      first_name = payload->>'first_name',
      last_name = payload->>'last_name',
      name = payload->>'name',
      phone = payload->>'phone',
      street = payload->>'street',
      city = payload->>'city',
      state = payload->>'state',
      zip = payload->>'zip',
      contact_address = payload->'contact_address',
      delivery_address = payload->'delivery_address',
      drop_off_date = v_drop_off_date,
      pickup_date = v_pickup_date,
      drop_off_time_slot = payload->>'drop_off_time_slot',
      pickup_time_slot = payload->>'pickup_time_slot',
      notes = payload->>'notes',
      service_id = v_service_id,
      plan_data = payload->'plan_data',
      addons_data = payload->'addons_data',
      booking_data = payload->'booking_data',
      total_price = v_total_price,
      base_price = v_base_price,
      delivery_service = v_delivery_service,
      is_verified = CASE WHEN v_mark_verified THEN true ELSE false END,
      verified_at = CASE WHEN v_mark_verified THEN now() ELSE null END,
      booking_id = CASE
        WHEN booking_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.bookings b
               WHERE b.id = booking_id
                 AND lower(COALESCE(b.status, '')) IN (
                   'booking_not_finished', 'cancelled', 'canceled'
                 )
             )
          THEN NULL
        WHEN booking_id IS NOT NULL
             AND v_drop_off_date IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.bookings b
               WHERE b.id = booking_id
                 AND public.booking_status_is_converted(b.status)
                 AND (
                   b.drop_off_date IS DISTINCT FROM v_drop_off_date
                   OR COALESCE(b.pickup_date, b.drop_off_date)
                      IS DISTINCT FROM COALESCE(v_pickup_date, v_drop_off_date)
                 )
             )
          THEN NULL
        ELSE booking_id
      END,
      created_at = now()
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  INSERT INTO public.pending_customers (
    email, first_name, last_name, name, phone, street, city, state, zip,
    contact_address, delivery_address, drop_off_date, pickup_date,
    drop_off_time_slot, pickup_time_slot, notes, service_id, plan_data,
    addons_data, booking_data, total_price, base_price, delivery_service,
    is_verified, verified_at
  )
  VALUES (
    v_email,
    payload->>'first_name',
    payload->>'last_name',
    payload->>'name',
    payload->>'phone',
    payload->>'street',
    payload->>'city',
    payload->>'state',
    payload->>'zip',
    payload->'contact_address',
    payload->'delivery_address',
    v_drop_off_date,
    v_pickup_date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->>'notes',
    v_service_id,
    payload->'plan_data',
    payload->'addons_data',
    payload->'booking_data',
    v_total_price,
    v_base_price,
    v_delivery_service,
    v_mark_verified,
    CASE WHEN v_mark_verified THEN now() ELSE null END
  )
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$_$;


ALTER FUNCTION "public"."store_pending_booking"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_feedback_response"("p_token" "text", "p_answers" "jsonb", "p_comments" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  t record;
  response_id bigint;
  chat_body text;
  q record;
  answer_val text;
  comments_clean text := trim(COALESCE(p_comments, ''));
  answers_ctx jsonb := '[]'::jsonb;
  message_ctx jsonb;
  v_chat_expires timestamptz;
BEGIN
  IF comments_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please share a comment so we can improve');
  END IF;

  SELECT * INTO t FROM public.feedback_tokens WHERE token = p_token FOR UPDATE;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link was already used');
  END IF;

  IF t.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link has expired');
  END IF;

  INSERT INTO public.feedback_responses (
    customer_id, booking_id, token_id, answers, comments, source
  )
  VALUES (
    t.customer_id, t.booking_id, t.id, COALESCE(p_answers, '{}'::jsonb), comments_clean, 'early_leave'
  )
  RETURNING id INTO response_id;

  v_chat_expires := timezone('utc', now()) + interval '30 days';

  UPDATE public.feedback_tokens
  SET used_at = timezone('utc', now()), chat_expires_at = v_chat_expires
  WHERE id = t.id;

  PERFORM public.mark_customer_feedback_lead(t.customer_id);

  chat_body := E'How can we do better — customer feedback submitted:\n\n';
  FOR q IN
    SELECT prompt, field_key FROM public.feedback_questions WHERE is_active = true ORDER BY sort_order, id
  LOOP
    answer_val := COALESCE(p_answers->>q.field_key, '');
    IF answer_val <> '' THEN
      chat_body := chat_body || '• ' || q.prompt || E'\n  → ' || answer_val || E'\n\n';
      answers_ctx := answers_ctx || jsonb_build_array(
        jsonb_build_object('prompt', q.prompt, 'field_key', q.field_key, 'answer', answer_val)
      );
    END IF;
  END LOOP;
  chat_body := chat_body || E'Comments:\n' || comments_clean;

  message_ctx := jsonb_build_object(
    'type', 'how_can_we_do_better',
    'feedback_response_id', response_id,
    'answers', answers_ctx,
    'comments', comments_clean,
    'booking_id', t.booking_id
  );

  INSERT INTO public.chat_messages (
    conversation_id, customer_id, booking_id, sender_type, message_content, is_read, message_severity, message_context
  )
  VALUES (
    'cust_' || t.customer_id::text, t.customer_id, t.booking_id, 'admin', chat_body, false, 'info', message_ctx
  );

  UPDATE public.customers SET has_unread_notes = true WHERE id = t.customer_id;

  RETURN jsonb_build_object(
    'ok', true, 'mode', 'chat', 'response_id', response_id,
    'customer_id', t.customer_id, 'chat_expires_at', v_chat_expires
  );
END;
$$;


ALTER FUNCTION "public"."submit_feedback_response"("p_token" "text", "p_answers" "jsonb", "p_comments" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("already_processed" boolean, "points_delta" integer, "new_balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_customer_id bigint;
  v_status text;
  v_points_per_dollar integer;
  v_target integer;
  v_current_net integer := 0;
  v_delta integer;
  v_balance integer := 0;
  v_addons jsonb;
  v_had_loyalty boolean := false;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.customer_id, b.status, COALESCE(b.addons, '{}'::jsonb)
    INTO v_customer_id, v_status, v_addons
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking % not found or missing customer', p_booking_id;
  END IF;

  IF v_status IN ('Cancelled', 'cancellation_pending') THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id AND lt.transaction_type = 'cancelled'
  ) THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE
             WHEN lt.transaction_type = 'earned' THEN lt.points_amount
             WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
             ELSE 0
           END
         ), 0)
    INTO v_current_net
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type IN ('earned', 'reschedule_adjustment');

  v_had_loyalty := (
    v_current_net <> 0
    OR COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0) > 0
    OR EXISTS (
      SELECT 1 FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type IN ('earned', 'reschedule_adjustment')
    )
  );

  -- Do not award loyalty before finalize-booking has granted it
  IF NOT v_had_loyalty THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_current_net = 0 THEN
    v_current_net := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
  END IF;

  SELECT COALESCE(ls.points_per_dollar, 10)
    INTO v_points_per_dollar
    FROM public.loyalty_settings ls
   LIMIT 1;
  v_points_per_dollar := COALESCE(v_points_per_dollar, 10);

  v_target := GREATEST(0, FLOOR(COALESCE(p_new_total, 0) * v_points_per_dollar)::integer);
  v_delta := v_target - v_current_net;

  IF v_delta = 0 THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.loyalty_points (customer_id, points_balance, total_points_earned, total_points_redeemed)
  VALUES (v_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF v_delta > 0 THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_earned = total_points_earned + v_delta,
           last_updated = now()
     WHERE customer_id = v_customer_id
     RETURNING points_balance INTO v_balance;
  ELSE
    IF COALESCE(v_balance, 0) < abs(v_delta) THEN
      v_delta := -GREATEST(0, COALESCE(v_balance, 0));
    END IF;
    IF v_delta <> 0 THEN
      UPDATE public.loyalty_points
         SET points_balance = points_balance + v_delta,
             total_points_earned = GREATEST(0, total_points_earned + v_delta),
             last_updated = now()
       WHERE customer_id = v_customer_id
       RETURNING points_balance INTO v_balance;
    END IF;
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      notes
    )
    VALUES (
      v_customer_id,
      'reschedule_adjustment',
      v_delta,
      p_booking_id,
      COALESCE(p_reason, format('Reschedule/price adjustment for booking #%s', p_booking_id))
    );
  END IF;

  UPDATE public.bookings
     SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('loyaltyPointsEarned', v_target)
   WHERE id = p_booking_id;

  already_processed := false;
  points_delta := v_delta;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking record;
  v_addons jsonb;
  v_service_id integer;
  v_elected_at timestamptz;
  v_insurance_plan record;
  v_driveway_plan record;
  v_insurance_plan_id uuid;
  v_driveway_plan_id uuid;
  v_cancel_reason text;
BEGIN
  SELECT b.*, COALESCE((b.plan->>'id')::integer, NULL) AS plan_service_id
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_addons := COALESCE(v_booking.addons, '{}'::jsonb);
  v_service_id := v_booking.plan_service_id;
  v_elected_at := COALESCE(v_booking.created_at, timezone('utc', now()));
  v_cancel_reason := COALESCE(
    NULLIF(v_addons->>'protectionCancellationReason', ''),
    'Coverage removed from booking'
  );

  v_insurance_plan_id := NULLIF(v_addons->'protectionPlanIds'->>'rentalInsurance', '')::uuid;
  v_driveway_plan_id := NULLIF(v_addons->'protectionPlanIds'->>'drivewayProtection', '')::uuid;

  IF v_insurance_plan_id IS NULL AND v_service_id IS NOT NULL THEN
    SELECT pp.* INTO v_insurance_plan
    FROM public.protection_plans pp
    INNER JOIN public.protection_plan_services pps ON pps.protection_plan_id = pp.id
    WHERE pp.plan_type = 'rental_insurance'
      AND pp.is_active = true
      AND pps.service_id = v_service_id
    ORDER BY pp.is_primary DESC, pp.display_order ASC
    LIMIT 1;
    v_insurance_plan_id := v_insurance_plan.id;
  ELSIF v_insurance_plan_id IS NOT NULL THEN
    SELECT * INTO v_insurance_plan FROM public.protection_plans WHERE id = v_insurance_plan_id;
  ELSE
    SELECT * INTO v_insurance_plan
    FROM public.protection_plans
    WHERE plan_key = 'premium_insurance'
    LIMIT 1;
    v_insurance_plan_id := v_insurance_plan.id;
  END IF;

  IF v_driveway_plan_id IS NULL AND v_service_id IS NOT NULL THEN
    SELECT pp.* INTO v_driveway_plan
    FROM public.protection_plans pp
    INNER JOIN public.protection_plan_services pps ON pps.protection_plan_id = pp.id
    WHERE pp.plan_type = 'driveway_protection'
      AND pp.is_active = true
      AND pps.service_id = v_service_id
    ORDER BY pp.is_primary DESC, pp.display_order ASC
    LIMIT 1;
    v_driveway_plan_id := v_driveway_plan.id;
  ELSIF v_driveway_plan_id IS NOT NULL THEN
    SELECT * INTO v_driveway_plan FROM public.protection_plans WHERE id = v_driveway_plan_id;
  ELSE
    SELECT * INTO v_driveway_plan
    FROM public.protection_plans
    WHERE plan_key = 'driveway_protection'
    LIMIT 1;
    v_driveway_plan_id := v_driveway_plan.id;
  END IF;

  IF v_insurance_plan_id IS NOT NULL AND v_addons ? 'insurance' THEN
    INSERT INTO public.booking_protection_plans (
      booking_id, customer_id, protection_plan_id, plan_type,
      plan_name_snapshot, price_applied, election, elected_at, service_id_at_purchase
    ) VALUES (
      p_booking_id,
      v_booking.customer_id,
      v_insurance_plan_id,
      'rental_insurance',
      COALESCE(v_insurance_plan.name, 'Premium Insurance'),
      CASE
        WHEN COALESCE(v_addons->>'insurance', 'decline') = 'accept'
        THEN COALESCE(
          NULLIF(v_addons->>'insurancePriceApplied', '')::numeric,
          v_insurance_plan.price,
          0
        )
        ELSE 0
      END,
      COALESCE(v_addons->>'insurance', 'decline'),
      v_elected_at,
      v_service_id
    )
    ON CONFLICT (booking_id, plan_type) DO UPDATE SET
      protection_plan_id = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.protection_plan_id
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.protection_plan_id
        ELSE EXCLUDED.protection_plan_id
      END,
      plan_name_snapshot = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.plan_name_snapshot
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.plan_name_snapshot
        ELSE EXCLUDED.plan_name_snapshot
      END,
      price_applied = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.price_applied
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.price_applied
        ELSE EXCLUDED.price_applied
      END,
      election = CASE
        WHEN EXCLUDED.election = 'accept' THEN 'accept'
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.election
        ELSE EXCLUDED.election
      END,
      elected_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.elected_at
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.elected_at
        ELSE EXCLUDED.elected_at
      END,
      service_id_at_purchase = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.service_id_at_purchase
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.service_id_at_purchase
        ELSE EXCLUDED.service_id_at_purchase
      END,
      cancelled_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN timezone('utc', now())
        ELSE booking_protection_plans.cancelled_at
      END,
      cancellation_reason = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN v_cancel_reason
        ELSE booking_protection_plans.cancellation_reason
      END;
  END IF;

  IF v_driveway_plan_id IS NOT NULL AND v_addons ? 'drivewayProtection' THEN
    INSERT INTO public.booking_protection_plans (
      booking_id, customer_id, protection_plan_id, plan_type,
      plan_name_snapshot, price_applied, election, elected_at, service_id_at_purchase
    ) VALUES (
      p_booking_id,
      v_booking.customer_id,
      v_driveway_plan_id,
      'driveway_protection',
      COALESCE(v_driveway_plan.name, 'Driveway Protection'),
      CASE
        WHEN COALESCE(v_addons->>'drivewayProtection', 'decline') = 'accept'
        THEN COALESCE(
          NULLIF(v_addons->>'drivewayPriceApplied', '')::numeric,
          v_driveway_plan.price,
          0
        )
        ELSE 0
      END,
      COALESCE(v_addons->>'drivewayProtection', 'decline'),
      v_elected_at,
      v_service_id
    )
    ON CONFLICT (booking_id, plan_type) DO UPDATE SET
      protection_plan_id = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.protection_plan_id
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.protection_plan_id
        ELSE EXCLUDED.protection_plan_id
      END,
      plan_name_snapshot = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.plan_name_snapshot
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.plan_name_snapshot
        ELSE EXCLUDED.plan_name_snapshot
      END,
      price_applied = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.price_applied
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.price_applied
        ELSE EXCLUDED.price_applied
      END,
      election = CASE
        WHEN EXCLUDED.election = 'accept' THEN 'accept'
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.election
        ELSE EXCLUDED.election
      END,
      elected_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.elected_at
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.elected_at
        ELSE EXCLUDED.elected_at
      END,
      service_id_at_purchase = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.service_id_at_purchase
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.service_id_at_purchase
        ELSE EXCLUDED.service_id_at_purchase
      END,
      cancelled_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN timezone('utc', now())
        ELSE booking_protection_plans.cancelled_at
      END,
      cancellation_reason = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN v_cancel_reason
        ELSE booking_protection_plans.cancellation_reason
      END;
  END IF;

  IF v_booking.status = 'Cancelled' THEN
    PERFORM public.cancel_booking_protection_plans(p_booking_id);
  END IF;
END;
$$;


ALTER FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_booking record;
  v_service_id integer;
begin
  delete from public.booking_resource_reservations where booking_id = p_booking_id;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    return;
  end if;
  if not public.booking_status_is_active(v_booking.status) then
    return;
  end if;

  v_service_id := public.resolve_booking_service_id(v_booking.plan, v_booking.addons);
  if v_service_id is null then
    return;
  end if;

  insert into public.booking_resource_reservations
    (booking_id, resource_id, quantity, reserved_date, slot_start, slot_end, granularity)
  select p_booking_id, r.resource_id, r.quantity, r.reserved_date, r.slot_start, r.slot_end, r.granularity
    from public.booking_reservation_rows(
           v_service_id,
           v_booking.drop_off_date,
           v_booking.pickup_date,
           v_booking.drop_off_window_start,
           v_booking.drop_off_window_end,
           v_booking.pickup_window_start,
           v_booking.pickup_window_end
         ) r;
end;
$$;


ALTER FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) IS 'Rebuilds booking_resource_reservations for one booking. SECURITY DEFINER so admin status/date updates can re-sync despite service-role-only RLS on the reservations table.';



CREATE OR REPLACE FUNCTION "public"."sync_booking_reservations_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.sync_booking_reservations(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_booking_reservations_trigger"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_booking_reservations_trigger"() IS 'AFTER INSERT/UPDATE trigger wrapper for sync_booking_reservations. SECURITY DEFINER.';



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


CREATE OR REPLACE FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint DEFAULT NULL::bigint, "p_pending_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_booking_ok boolean := false;
  v_pending_ok boolean := false;
BEGIN
  IF p_booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET checkout_last_seen_at = v_now
    WHERE id = p_booking_id
      AND lower(COALESCE(status, '')) = 'pending_payment';
    v_booking_ok := FOUND;
  END IF;

  IF p_pending_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET last_seen_at = v_now
    WHERE id = p_pending_id;
    v_pending_ok := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_touched', v_booking_ok,
    'pending_touched', v_pending_ok,
    'at', v_now
  );
END;
$$;


ALTER FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint, "p_pending_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_lock_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_lock_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_sync_booking_protection_plans"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.addons IS DISTINCT FROM OLD.addons THEN
    PERFORM public.sync_booking_protection_plans(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_sync_booking_protection_plans"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ai_knowledge_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_ai_knowledge_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_license_from_checkout"("p_booking_id" bigint, "p_license_plate" "text", "p_license_image_urls" "jsonb", "p_insurance_image" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_customer_id bigint;
  v_front_url text;
  v_front_path text;
  v_back_url text;
  v_back_path text;
  v_insurance_url text;
  v_insurance_path text;
  v_plate text;
  v_status text;
  v_has_any_doc boolean;
  v_docs_complete boolean;
BEGIN
  SELECT b.customer_id
    INTO v_customer_id
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.status = 'pending_payment';

  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.customers c
  SET
    license_plate = COALESCE(NULLIF(TRIM(p_license_plate), ''), c.license_plate),
    license_image_urls = COALESCE(p_license_image_urls, c.license_image_urls)
  WHERE c.id = v_customer_id;

  SELECT NULLIF(TRIM(c.license_plate), '')
    INTO v_plate
  FROM public.customers c
  WHERE c.id = v_customer_id;

  v_front_url := p_license_image_urls->0->>'url';
  v_front_path := p_license_image_urls->0->>'path';
  v_back_url := p_license_image_urls->1->>'url';
  v_back_path := p_license_image_urls->1->>'path';
  v_insurance_url := p_insurance_image->>'url';
  v_insurance_path := p_insurance_image->>'path';

  v_has_any_doc :=
    COALESCE(v_front_url, v_front_path) IS NOT NULL
    OR COALESCE(v_back_url, v_back_path) IS NOT NULL
    OR COALESCE(v_insurance_url, v_insurance_path) IS NOT NULL;

  IF NOT v_has_any_doc THEN
    RETURN;
  END IF;

  v_docs_complete :=
    COALESCE(v_front_url, v_front_path) IS NOT NULL
    AND COALESCE(v_back_url, v_back_path) IS NOT NULL
    AND COALESCE(v_insurance_url, v_insurance_path) IS NOT NULL
    AND v_plate IS NOT NULL;

  v_status := CASE WHEN v_docs_complete THEN 'approved' ELSE 'pending' END;

  INSERT INTO public.driver_verification_documents AS d (
    customer_id,
    license_front_url,
    license_front_storage_path,
    license_back_url,
    license_back_storage_path,
    insurance_url,
    insurance_storage_path,
    uploaded_at,
    verification_status
  )
  VALUES (
    v_customer_id,
    v_front_url,
    v_front_path,
    v_back_url,
    v_back_path,
    v_insurance_url,
    v_insurance_path,
    now(),
    v_status
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    license_front_url = COALESCE(EXCLUDED.license_front_url, d.license_front_url),
    license_front_storage_path = COALESCE(EXCLUDED.license_front_storage_path, d.license_front_storage_path),
    license_back_url = COALESCE(EXCLUDED.license_back_url, d.license_back_url),
    license_back_storage_path = COALESCE(EXCLUDED.license_back_storage_path, d.license_back_storage_path),
    insurance_url = COALESCE(EXCLUDED.insurance_url, d.insurance_url),
    insurance_storage_path = COALESCE(EXCLUDED.insurance_storage_path, d.insurance_storage_path),
    uploaded_at = now(),
    verification_status = CASE
      WHEN (
        COALESCE(EXCLUDED.license_front_url, EXCLUDED.license_front_storage_path, d.license_front_url, d.license_front_storage_path) IS NOT NULL
        AND COALESCE(EXCLUDED.license_back_url, EXCLUDED.license_back_storage_path, d.license_back_url, d.license_back_storage_path) IS NOT NULL
        AND COALESCE(EXCLUDED.insurance_url, EXCLUDED.insurance_storage_path, d.insurance_url, d.insurance_storage_path) IS NOT NULL
        AND NULLIF(TRIM(COALESCE(
          (SELECT c.license_plate FROM public.customers c WHERE c.id = d.customer_id),
          ''
        )), '') IS NOT NULL
      ) THEN 'approved'
      WHEN d.verification_status = 'approved' THEN 'approved'
      ELSE 'pending'
    END;

  UPDATE public.customers c
  SET has_incomplete_verification = false
  FROM public.driver_verification_documents d
  WHERE c.id = v_customer_id
    AND d.customer_id = v_customer_id
    AND d.verification_status = 'approved';
END;
$$;


ALTER FUNCTION "public"."update_customer_license_from_checkout"("p_booking_id" bigint, "p_license_plate" "text", "p_license_image_urls" "jsonb", "p_insurance_image" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text" DEFAULT 'expired'::"text", "p_set_reminder_sent" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  b record;
  v_service_name text;
  v_id bigint;
  v_cart jsonb;
  v_source text;
  v_tags text[];
  v_status text;
  v_plan jsonb;
  v_plan_id int;
  v_pending_service_id int;
BEGIN
  v_status := lower(COALESCE(NULLIF(trim(p_status), ''), 'expired'));

  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO b
    FROM public.bookings
   WHERE id = p_booking_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(b.email, '') = '' THEN
    RETURN NULL;
  END IF;

  v_source := CASE
    WHEN v_status = 'left_early' THEN 'left_early'
    ELSE 'pending_payment'
  END;

  v_plan := CASE
    WHEN b.plan IS NULL THEN NULL
    WHEN jsonb_typeof(b.plan) = 'null' THEN NULL
    WHEN b.plan = '{}'::jsonb THEN NULL
    ELSE b.plan
  END;

  v_plan_id := NULLIF(COALESCE(v_plan->>'id', ''), '')::int;

  SELECT pc.service_id
    INTO v_pending_service_id
    FROM public.pending_customers pc
   WHERE pc.booking_id = b.id
   ORDER BY pc.created_at DESC NULLS LAST, pc.id DESC
   LIMIT 1;

  IF v_plan_id IS NULL THEN
    v_plan_id := v_pending_service_id;
  END IF;

  v_service_name := NULLIF(trim(COALESCE(v_plan->>'name', '')), '');

  IF v_service_name IS NULL AND v_plan_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = v_plan_id;
  END IF;

  IF v_service_name IS NULL AND v_pending_service_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = v_pending_service_id;
  END IF;

  v_service_name := COALESCE(NULLIF(trim(v_service_name), ''), 'Service');

  IF v_plan IS NULL THEN
    v_plan := '{}'::jsonb;
  END IF;

  IF v_plan_id IS NOT NULL AND NULLIF(v_plan->>'id', '') IS NULL THEN
    v_plan := v_plan || jsonb_build_object('id', v_plan_id);
  END IF;

  IF NULLIF(trim(COALESCE(v_plan->>'name', '')), '') IS NULL
     AND v_service_name IS DISTINCT FROM 'Service' THEN
    v_plan := v_plan || jsonb_build_object('name', v_service_name);
  END IF;

  v_tags := public.abandoned_checkout_service_tags(v_service_name, v_plan, b.addons);

  v_cart := jsonb_build_object(
    'booking_id', b.id,
    'plan', v_plan,
    'addons', b.addons,
    'contact_address', b.contact_address,
    'delivery_address', b.delivery_address,
    'drop_off_date', b.drop_off_date,
    'pickup_date', b.pickup_date,
    'drop_off_time_slot', b.drop_off_time_slot,
    'pickup_time_slot', b.pickup_time_slot,
    'total_price', b.total_price,
    'subtotal_before_tax', b.subtotal_before_tax,
    'tax_amount', b.tax_amount,
    'distance_miles', b.distance_miles
  );

  INSERT INTO public.abandoned_checkouts AS ac (
    email,
    phone,
    full_name,
    source,
    booking_id,
    service_name,
    plan,
    addons,
    cart_snapshot,
    total_price,
    drop_off_date,
    pickup_date,
    status,
    reminder_sent_at,
    expired_at,
    marketing_eligible,
    tags,
    meta
  )
  VALUES (
    lower(trim(b.email)),
    NULLIF(b.phone, ''),
    NULLIF(trim(COALESCE(b.name, concat_ws(' ', b.first_name, b.last_name))), ''),
    v_source,
    b.id,
    v_service_name,
    v_plan,
    b.addons,
    v_cart,
    b.total_price,
    b.drop_off_date::date,
    b.pickup_date::date,
    v_status,
    CASE WHEN p_set_reminder_sent OR v_status = 'reminded' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'expired' THEN now() ELSE NULL END,
    true,
    v_tags,
    jsonb_build_object('last_source_status', b.status)
  )
  ON CONFLICT (booking_id)
  DO UPDATE SET
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, ac.phone),
    full_name = COALESCE(EXCLUDED.full_name, ac.full_name),
    source = CASE
      WHEN EXCLUDED.source = 'left_early' THEN EXCLUDED.source
      WHEN ac.source = 'left_early' THEN ac.source
      ELSE COALESCE(ac.source, EXCLUDED.source)
    END,
    service_name = CASE
      WHEN EXCLUDED.service_name IS DISTINCT FROM 'Service' THEN EXCLUDED.service_name
      WHEN COALESCE(ac.service_name, '') IN ('', 'Service') THEN EXCLUDED.service_name
      ELSE COALESCE(ac.service_name, EXCLUDED.service_name)
    END,
    plan = CASE
      WHEN EXCLUDED.plan IS NOT NULL
           AND jsonb_typeof(EXCLUDED.plan) <> 'null'
           AND EXCLUDED.plan <> '{}'::jsonb
           AND NULLIF(trim(COALESCE(EXCLUDED.plan->>'name', '')), '') IS NOT NULL
        THEN EXCLUDED.plan
      ELSE COALESCE(ac.plan, EXCLUDED.plan)
    END,
    addons = COALESCE(EXCLUDED.addons, ac.addons),
    cart_snapshot = COALESCE(EXCLUDED.cart_snapshot, ac.cart_snapshot),
    total_price = COALESCE(EXCLUDED.total_price, ac.total_price),
    drop_off_date = COALESCE(EXCLUDED.drop_off_date, ac.drop_off_date),
    pickup_date = COALESCE(EXCLUDED.pickup_date, ac.pickup_date),
    status = CASE
      WHEN ac.status = 'unsubscribed' THEN ac.status
      WHEN ac.status = 'converted' THEN ac.status
      WHEN ac.status = 'left_early'
           AND EXCLUDED.status IN ('reminded', 'expired')
           AND (
             p_set_reminder_sent
             OR COALESCE((b.addons->>'idle_prompt_shown')::boolean, false)
           )
        THEN EXCLUDED.status
      WHEN ac.status = 'left_early' AND EXCLUDED.status IN ('expired', 'reminded', 'open') THEN ac.status
      WHEN EXCLUDED.status = 'left_early' THEN EXCLUDED.status
      ELSE EXCLUDED.status
    END,
    reminder_sent_at = CASE
      WHEN p_set_reminder_sent OR v_status = 'reminded' THEN COALESCE(ac.reminder_sent_at, now())
      ELSE ac.reminder_sent_at
    END,
    expired_at = CASE
      WHEN v_status = 'expired'
           AND ac.status IS DISTINCT FROM 'left_early'
           AND ac.status IS DISTINCT FROM 'converted'
           AND ac.status IS DISTINCT FROM 'unsubscribed'
        THEN COALESCE(ac.expired_at, now())
      ELSE ac.expired_at
    END,
    tags = CASE
      WHEN EXCLUDED.tags IS NOT NULL
           AND NOT (EXCLUDED.tags = ARRAY['other-service']::text[])
        THEN EXCLUDED.tags
      WHEN COALESCE(array_length(ac.tags, 1), 0) = 0 THEN EXCLUDED.tags
      WHEN ac.tags = ARRAY['other-service']::text[] THEN EXCLUDED.tags
      ELSE (
        SELECT ARRAY(
          SELECT DISTINCT t
          FROM unnest(COALESCE(ac.tags, '{}'::text[]) || EXCLUDED.tags) AS t
          WHERE t IS NOT NULL AND length(trim(t)) > 0
          ORDER BY t
        )
      )
    END,
    meta = COALESCE(ac.meta, '{}'::jsonb) || EXCLUDED.meta,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text", "p_set_reminder_sent" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_booking_mileage_log"("p_booking_id" bigint, "p_one_way_miles" numeric DEFAULT NULL::numeric, "p_source" "text" DEFAULT 'booking_create'::"text", "p_address_snapshot" "jsonb" DEFAULT NULL::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_customer_miles numeric;
  v_one_way numeric;
  v_trip_kind text;
  v_round numeric;
  v_service_id bigint;
  v_service_name text;
  v_service_type text;
  v_addr jsonb;
  v_id bigint;
  v_source text;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_source := COALESCE(NULLIF(trim(p_source), ''), 'booking_create');
  IF v_source NOT IN ('booking_create', 'reschedule_address', 'backfill', 'booking_complete') THEN
    v_source := 'booking_create';
  END IF;

  SELECT c.distance_miles INTO v_customer_miles
  FROM public.customers c
  WHERE c.id = v_booking.customer_id;

  v_one_way := COALESCE(
    NULLIF(p_one_way_miles, 0),
    NULLIF(v_booking.distance_miles, 0),
    NULLIF(v_customer_miles, 0),
    NULLIF((v_booking.addons->>'oneWayDistanceMiles')::numeric, 0),
    0
  );

  IF v_one_way <= 0 THEN
    RETURN NULL;
  END IF;

  IF v_booking.distance_miles IS NULL OR v_booking.distance_miles = 0 OR p_one_way_miles IS NOT NULL THEN
    UPDATE public.bookings
    SET distance_miles = v_one_way
    WHERE id = p_booking_id;
  END IF;

  IF public.booking_is_company_delivery(v_booking) THEN
    v_trip_kind := 'delivery_pickup';
  ELSE
    v_trip_kind := 'one_way';
  END IF;

  v_round := round(v_one_way * 2, 2);
  v_service_id := NULLIF(v_booking.plan->>'id', '')::bigint;
  v_service_name := COALESCE(v_booking.plan->>'name', 'Unknown Service');
  v_service_type := COALESCE(v_booking.plan->>'service_type', v_booking.delivery_type, 'rental');
  v_addr := COALESCE(
    p_address_snapshot,
    v_booking.delivery_address,
    jsonb_build_object(
      'street', v_booking.street,
      'city', v_booking.city,
      'state', v_booking.state,
      'zip', v_booking.zip
    )
  );

  INSERT INTO public.booking_mileage_logs (
    booking_id,
    customer_id,
    service_id,
    service_name,
    service_type,
    one_way_miles,
    round_trip_miles,
    trip_kind,
    address_snapshot,
    source,
    recorded_at,
    updated_at
  )
  VALUES (
    p_booking_id,
    v_booking.customer_id,
    v_service_id,
    v_service_name,
    v_service_type,
    round(v_one_way, 2),
    v_round,
    v_trip_kind,
    v_addr,
    v_source,
    now(),
    now()
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    service_id = EXCLUDED.service_id,
    service_name = EXCLUDED.service_name,
    service_type = EXCLUDED.service_type,
    one_way_miles = EXCLUDED.one_way_miles,
    round_trip_miles = EXCLUDED.round_trip_miles,
    trip_kind = EXCLUDED.trip_kind,
    address_snapshot = EXCLUDED.address_snapshot,
    source = EXCLUDED.source,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."upsert_booking_mileage_log"("p_booking_id" bigint, "p_one_way_miles" numeric, "p_source" "text", "p_address_snapshot" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking record;
  v_addons jsonb;
  v_id uuid;
  v_tax numeric;
  v_rate numeric;
  v_subtotal numeric;
  v_taxable numeric;
  v_nontaxable numeric;
  v_line_items jsonb;
  v_delivery text;
  v_jurisdiction text;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_addons := COALESCE(v_booking.addons, '{}'::jsonb);
  v_tax := COALESCE(v_booking.tax_amount, 0);
  v_rate := COALESCE(v_booking.tax_rate_used, 0);
  v_subtotal := COALESCE(v_booking.subtotal_before_tax, GREATEST(0, COALESCE(v_booking.total_price, 0) - v_tax));
  v_taxable := COALESCE(NULLIF(v_addons->>'taxableSubtotal', '')::numeric, v_subtotal);
  v_nontaxable := COALESCE(NULLIF(v_addons->>'nonTaxableSubtotal', '')::numeric, 0);
  v_line_items := COALESCE(v_addons->'taxLineItemsSnapshot', '[]'::jsonb);
  v_jurisdiction := COALESCE(v_booking.tax_jurisdiction, v_addons->>'taxJurisdiction');

  v_delivery := COALESCE(v_booking.delivery_type, v_addons->>'deliveryType');
  IF v_delivery IS NOT NULL AND v_delivery NOT IN ('delivery', 'self_service_trailer', 'self_pickup') THEN
    v_delivery := NULL;
  END IF;

  IF v_tax <= 0 AND v_rate <= 0 THEN
    -- Still ensure a row exists for audit when tax columns are zero after sync
    NULL;
  END IF;

  INSERT INTO public.tax_records (
    booking_id,
    tax_amount,
    tax_rate,
    subtotal_before_tax,
    taxable_subtotal,
    non_taxable_subtotal,
    line_items,
    delivery_type,
    tax_jurisdiction,
    tax_api_used,
    voided_at,
    void_reason
  ) VALUES (
    p_booking_id,
    v_tax,
    v_rate,
    v_subtotal,
    v_taxable,
    v_nontaxable,
    v_line_items,
    v_delivery,
    v_jurisdiction,
    COALESCE(v_addons->>'taxApiUsed', 'business_settings'),
    CASE WHEN v_booking.status = 'Cancelled' THEN timezone('utc', now()) ELSE NULL END,
    CASE WHEN v_booking.status = 'Cancelled' THEN 'Booking cancelled' ELSE NULL END
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    tax_amount = EXCLUDED.tax_amount,
    tax_rate = EXCLUDED.tax_rate,
    subtotal_before_tax = EXCLUDED.subtotal_before_tax,
    taxable_subtotal = EXCLUDED.taxable_subtotal,
    non_taxable_subtotal = EXCLUDED.non_taxable_subtotal,
    line_items = EXCLUDED.line_items,
    delivery_type = COALESCE(EXCLUDED.delivery_type, tax_records.delivery_type),
    tax_jurisdiction = COALESCE(EXCLUDED.tax_jurisdiction, tax_records.tax_jurisdiction),
    tax_api_used = COALESCE(EXCLUDED.tax_api_used, tax_records.tax_api_used),
    voided_at = CASE
      WHEN v_booking.status = 'Cancelled' THEN COALESCE(tax_records.voided_at, timezone('utc', now()))
      ELSE NULL
    END,
    void_reason = CASE
      WHEN v_booking.status = 'Cancelled' THEN COALESCE(tax_records.void_reason, 'Booking cancelled')
      ELSE NULL
    END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") IS 'Safely inserts or updates pending customer records with email deduplication. Use this function instead of direct INSERT to prevent duplicate email errors.';



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


CREATE OR REPLACE FUNCTION "public"."validate_referral_code"("p_referral_code" "text", "p_referee_email" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_referee_email text;
  v_referrer_email text;
BEGIN
  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'Please enter a referral code.'
    );
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code was not found.'
    );
  END IF;

  IF v_referral.status IN ('rewarded', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code is no longer active.'
    );
  END IF;

  IF v_referral.referee_customer_id IS NOT NULL OR v_referral.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code has already been used.'
    );
  END IF;

  v_referee_email := lower(trim(COALESCE(p_referee_email, '')));
  IF v_referee_email <> '' THEN
    SELECT lower(trim(c.email))
      INTO v_referrer_email
      FROM public.customers c
     WHERE c.id = v_referral.referrer_customer_id;

    IF v_referrer_email IS NOT NULL AND v_referrer_email = v_referee_email THEN
      RETURN jsonb_build_object(
        'isValid', false,
        'error', 'You cannot use your own referral code.'
      );
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.customers c
        JOIN public.referrals r ON r.referee_customer_id = c.id
       WHERE lower(trim(c.email)) = v_referee_email
         AND r.id <> v_referral.id
         AND r.status IN ('pending_completion', 'pending_activation', 'completed', 'rewarded')
    ) THEN
      RETURN jsonb_build_object(
        'isValid', false,
        'error', 'This email has already been referred.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'isValid', true,
    'code', v_referral.referral_code,
    'referralId', v_referral.id
  );
END;
$$;


ALTER FUNCTION "public"."validate_referral_code"("p_referral_code" "text", "p_referee_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_portal_booking_access"("p_booking_id" bigint, "p_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_normalized_phone text;
  v_booking_phone text;
BEGIN
  v_normalized_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_normalized_phone) < 4 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  v_booking_phone := regexp_replace(COALESCE(v_booking.phone, ''), '\D', '', 'g');
  IF NOT v_booking_phone LIKE ('%' || right(v_normalized_phone, 4)) THEN
    RAISE EXCEPTION 'Phone number does not match order';
  END IF;

  RETURN to_jsonb(v_booking);
END;
$$;


ALTER FUNCTION "public"."verify_portal_booking_access"("p_booking_id" bigint, "p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.tax_records
     SET voided_at = COALESCE(voided_at, timezone('utc', now())),
         void_reason = COALESCE(p_reason, void_reason, 'Booking cancelled')
   WHERE booking_id = p_booking_id
     AND voided_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."abandoned_checkouts" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "full_name" "text",
    "source" "text" DEFAULT 'pending_payment'::"text" NOT NULL,
    "booking_id" bigint,
    "service_name" "text",
    "plan" "jsonb",
    "addons" "jsonb",
    "cart_snapshot" "jsonb",
    "total_price" numeric(12,2),
    "drop_off_date" "date",
    "pickup_date" "date",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "marketing_eligible" boolean DEFAULT true NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "abandoned_checkouts_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reminded'::"text", 'expired'::"text", 'converted'::"text", 'unsubscribed'::"text", 'left_early'::"text"])))
);


ALTER TABLE "public"."abandoned_checkouts" OWNER TO "postgres";


COMMENT ON TABLE "public"."abandoned_checkouts" IS 'CRM leads for customers who reached payment but did not finalize. Expandable for campaigns/coupons.';



ALTER TABLE "public"."abandoned_checkouts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."abandoned_checkouts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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



CREATE TABLE IF NOT EXISTS "public"."booking_charge_transactions" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "charge_key" "text" NOT NULL,
    "charge_name" "text" NOT NULL,
    "charge_description" "text",
    "charge_amount" numeric(10,2) NOT NULL,
    "charge_source" "text" DEFAULT 'admin_manual'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booking_charge_transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."booking_charge_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."booking_charge_transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."booking_charge_transactions_id_seq" OWNED BY "public"."booking_charge_transactions"."id";



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



CREATE TABLE IF NOT EXISTS "public"."booking_fee_snapshots" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "fee_key" "text" NOT NULL,
    "fee_name" "text" NOT NULL,
    "fee_description" "text",
    "fee_value" numeric(10,2) NOT NULL,
    "is_percentage" boolean DEFAULT false,
    "snapshot_source" "text" DEFAULT 'agreement_step6_acceptance'::"text",
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."booking_fee_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."booking_fee_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."booking_fee_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."booking_fee_snapshots_id_seq" OWNED BY "public"."booking_fee_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."booking_mileage_logs" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "customer_id" bigint,
    "service_id" bigint,
    "service_name" "text",
    "service_type" "text",
    "one_way_miles" numeric(10,2) DEFAULT 0 NOT NULL,
    "round_trip_miles" numeric(10,2) DEFAULT 0 NOT NULL,
    "trip_kind" "text" DEFAULT 'none'::"text" NOT NULL,
    "address_snapshot" "jsonb",
    "source" "text" DEFAULT 'booking_create'::"text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_mileage_logs_source_check" CHECK (("source" = ANY (ARRAY['booking_create'::"text", 'reschedule_address'::"text", 'backfill'::"text", 'booking_complete'::"text"]))),
    CONSTRAINT "booking_mileage_logs_trip_kind_check" CHECK (("trip_kind" = ANY (ARRAY['delivery_pickup'::"text", 'one_way'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."booking_mileage_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."booking_mileage_logs" IS 'One-way Google miles per booking for route/maintenance tracking; round_trip = one_way * 2 for delivery trips';



ALTER TABLE "public"."booking_mileage_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."booking_mileage_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."booking_protection_plans" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "customer_id" bigint,
    "protection_plan_id" "uuid",
    "plan_type" "text" NOT NULL,
    "plan_name_snapshot" "text" NOT NULL,
    "price_applied" numeric(10,2) DEFAULT 0 NOT NULL,
    "election" "text" NOT NULL,
    "elected_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "service_id_at_purchase" integer,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    CONSTRAINT "booking_protection_plans_election_check" CHECK (("election" = ANY (ARRAY['accept'::"text", 'decline'::"text"])))
);


ALTER TABLE "public"."booking_protection_plans" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."booking_protection_plans_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."booking_protection_plans_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."booking_protection_plans_id_seq" OWNED BY "public"."booking_protection_plans"."id";



CREATE TABLE IF NOT EXISTS "public"."booking_resource_reservations" (
    "id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "resource_id" integer NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "reserved_date" "date" NOT NULL,
    "slot_start" time without time zone,
    "slot_end" time without time zone,
    "granularity" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_resource_reservations_granularity_check" CHECK (("granularity" = ANY (ARRAY['day'::"text", 'slot'::"text"]))),
    CONSTRAINT "booking_resource_reservations_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "brr_slot_times_consistent" CHECK (((("granularity" = 'day'::"text") AND ("slot_start" IS NULL) AND ("slot_end" IS NULL)) OR (("granularity" = 'slot'::"text") AND ("slot_start" IS NOT NULL) AND ("slot_end" IS NOT NULL) AND ("slot_end" > "slot_start"))))
);


ALTER TABLE "public"."booking_resource_reservations" OWNER TO "postgres";


COMMENT ON TABLE "public"."booking_resource_reservations" IS 'One row per (booking, resource, occupied day[, slot]). Expanded from a booking''s service, dates and time windows by booking_reservation_rows / sync_booking_reservations. Read by resource_quantity_used and by get-availability; never hand-written.';



ALTER TABLE "public"."booking_resource_reservations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."booking_resource_reservations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "tax_effective_date" "date" DEFAULT '2026-04-23'::"date",
    "tax_rate_pickup" numeric DEFAULT 7.45,
    "tax_rate_delivery" numeric DEFAULT 7.45
);


ALTER TABLE "public"."business_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."business_settings"."tax_rate_pickup" IS 'Sales tax rate (%) for self-pickup at business location';



COMMENT ON COLUMN "public"."business_settings"."tax_rate_delivery" IS 'Sales tax rate (%) fallback for delivery transactions';



CREATE SEQUENCE IF NOT EXISTS "public"."business_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."business_settings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."business_settings_id_seq" OWNED BY "public"."business_settings"."id";



CREATE TABLE IF NOT EXISTS "public"."charges_and_fees" (
    "id" bigint NOT NULL,
    "fee_key" character varying(100) NOT NULL,
    "fee_name" character varying(255) NOT NULL,
    "fee_description" "text",
    "fee_value" numeric(10,2) NOT NULL,
    "is_percentage" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."charges_and_fees" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."charges_and_fees_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."charges_and_fees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."charges_and_fees_id_seq" OWNED BY "public"."charges_and_fees"."id";



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
    "message_severity" "text",
    "message_context" "jsonb",
    CONSTRAINT "chat_messages_message_severity_check" CHECK ((("message_severity" IS NULL) OR ("message_severity" = ANY (ARRAY['success'::"text", 'warning'::"text", 'urgent'::"text", 'info'::"text"])))),
    CONSTRAINT "chat_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['admin'::"text", 'customer'::"text"])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."chat_messages"."message_severity" IS 'Optional semantic severity: success, warning, urgent, info.';



COMMENT ON COLUMN "public"."chat_messages"."message_context" IS 'Optional structured metadata associated with system/admin status messages.';



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



CREATE TABLE IF NOT EXISTS "public"."customer_referral_wallets" (
    "customer_id" bigint NOT NULL,
    "pending_balance" numeric(10,2) DEFAULT 0 NOT NULL,
    "available_balance" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_earned" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_redeemed" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_referral_wallets_available_balance_check" CHECK (("available_balance" >= (0)::numeric)),
    CONSTRAINT "customer_referral_wallets_pending_balance_check" CHECK (("pending_balance" >= (0)::numeric)),
    CONSTRAINT "customer_referral_wallets_total_earned_check" CHECK (("total_earned" >= (0)::numeric)),
    CONSTRAINT "customer_referral_wallets_total_redeemed_check" CHECK (("total_redeemed" >= (0)::numeric))
);


ALTER TABLE "public"."customer_referral_wallets" OWNER TO "postgres";


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
    "travel_time_minutes" integer,
    "sms_opt_in" boolean DEFAULT true,
    "sms_opt_out_at" timestamp with time zone,
    "segment" "text" DEFAULT 'booked'::"text" NOT NULL,
    CONSTRAINT "customers_segment_check" CHECK (("segment" = ANY (ARRAY['booked'::"text", 'feedback_lead'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."sms_opt_in" IS 'Customer consent for transactional SMS. Defaults true; set false on STOP.';



COMMENT ON COLUMN "public"."customers"."sms_opt_out_at" IS 'Timestamp when the customer opted out of SMS (e.g. replied STOP).';



COMMENT ON COLUMN "public"."customers"."segment" IS 'booked = default / has paid booking; feedback_lead = left early or submitted how-can-we-do-better feedback';



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
    "insurance_url" "text",
    "insurance_storage_path" "text",
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
    "is_taxable" boolean DEFAULT true NOT NULL,
    CONSTRAINT "equipment_pricing_item_type_check" CHECK (("item_type" = ANY (ARRAY['rental_equipment'::"text", 'consumable_item'::"text", 'service_item'::"text"])))
);


ALTER TABLE "public"."equipment_pricing" OWNER TO "postgres";


COMMENT ON COLUMN "public"."equipment_pricing"."is_taxable" IS 'Whether this equipment/item is subject to sales tax';



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



CREATE TABLE IF NOT EXISTS "public"."feedback_questions" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "prompt" "text" NOT NULL,
    "field_key" "text" NOT NULL,
    "input_type" "text" DEFAULT 'single_choice'::"text" NOT NULL,
    "options" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    CONSTRAINT "feedback_questions_input_type_check" CHECK (("input_type" = ANY (ARRAY['single_choice'::"text", 'multi_choice'::"text", 'short_text'::"text"])))
);


ALTER TABLE "public"."feedback_questions" OWNER TO "postgres";


ALTER TABLE "public"."feedback_questions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."feedback_questions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."feedback_responses" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "customer_id" bigint NOT NULL,
    "booking_id" bigint,
    "token_id" bigint,
    "answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "comments" "text" DEFAULT ''::"text" NOT NULL,
    "source" "text" DEFAULT 'early_leave'::"text" NOT NULL
);


ALTER TABLE "public"."feedback_responses" OWNER TO "postgres";


ALTER TABLE "public"."feedback_responses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."feedback_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."feedback_tokens" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "token" "text" NOT NULL,
    "customer_id" bigint NOT NULL,
    "booking_id" bigint,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "email_sent_at" timestamp with time zone,
    "email_message_id" "text",
    "chat_expires_at" timestamp with time zone,
    "chat_closed_at" timestamp with time zone,
    "last_chat_reply_email_at" timestamp with time zone
);


ALTER TABLE "public"."feedback_tokens" OWNER TO "postgres";


COMMENT ON COLUMN "public"."feedback_tokens"."chat_expires_at" IS 'When set, the survey token may open the public reply thread until this time.';



COMMENT ON COLUMN "public"."feedback_tokens"."chat_closed_at" IS 'When set, the public reply thread is closed even if chat_expires_at is in the future.';



COMMENT ON COLUMN "public"."feedback_tokens"."last_chat_reply_email_at" IS 'Debounce timestamp for admin-reply notification emails.';



ALTER TABLE "public"."feedback_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."feedback_tokens_id_seq"
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
    "quantity_required" integer DEFAULT 1 NOT NULL,
    "occupancy_model" "public"."service_occupancy_model",
    "scheduling_granularity" "text" DEFAULT 'day'::"text" NOT NULL,
    CONSTRAINT "inventory_rules_scheduling_granularity_check" CHECK (("scheduling_granularity" = ANY (ARRAY['day'::"text", 'slot'::"text"])))
);


ALTER TABLE "public"."inventory_rules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_rules"."occupancy_model" IS 'Overrides services.occupancy_model for this specific resource requirement. Null inherits from the service.';



COMMENT ON COLUMN "public"."inventory_rules"."scheduling_granularity" IS '''day'': this requirement blocks the whole day, like a rental sitting on a customer''s property. ''slot'': this requirement only blocks the generated time window it is reserved for, like a delivery truck making a short trip. Only meaningful combined with a dropoff_only or dropoff_and_pickup_only occupancy model — see booking_reservation_rows in the reservations migration for how the two combine.';



CREATE SEQUENCE IF NOT EXISTS "public"."inventory_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."inventory_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."inventory_rules_id_seq" OWNED BY "public"."inventory_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."lock_bridges" (
    "bridge_id" "text" NOT NULL,
    "label" "text",
    "is_online" boolean,
    "last_changed_at" timestamp with time zone,
    "last_event_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lock_bridges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lock_device_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "text" NOT NULL,
    "bridge_id" "text",
    "event_kind" "text" NOT NULL,
    "log_type" integer,
    "occurred_at" timestamp with time zone NOT NULL,
    "order_id" bigint,
    "pin_matched" boolean DEFAULT false NOT NULL,
    "key_id" "text",
    "operation_id" "text",
    "raw" "jsonb",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lock_device_events_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['lock'::"text", 'unlock'::"text", 'breakin'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."lock_device_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lock_devices" (
    "device_id" "text" NOT NULL,
    "bridge_id" "text",
    "equipment_id" bigint,
    "label" "text",
    "current_state" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "state_changed_at" timestamp with time zone,
    "last_event_at" timestamp with time zone,
    "last_breakin_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lock_devices_current_state_check" CHECK (("current_state" = ANY (ARRAY['locked'::"text", 'unlocked'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."lock_devices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."lock_device_presence" WITH ("security_invoker"='on') AS
 SELECT "d"."device_id",
    "d"."label",
    "d"."equipment_id",
    "e"."name" AS "equipment_name",
    "d"."bridge_id",
    "d"."current_state",
    "d"."state_changed_at",
    "d"."last_event_at",
    "d"."last_breakin_at",
    "b"."is_online" AS "bridge_online",
    "b"."last_changed_at" AS "bridge_changed_at",
        CASE
            WHEN (("d"."current_state" = 'unlocked'::"text") AND ("b"."is_online" IS FALSE)) THEN 'alert_open_and_offline'::"text"
            WHEN ("d"."current_state" = 'unlocked'::"text") THEN 'off_premises'::"text"
            WHEN ("d"."current_state" = 'locked'::"text") THEN 'on_premises'::"text"
            ELSE 'unknown'::"text"
        END AS "presence",
    ( SELECT "ev"."order_id"
           FROM "public"."lock_device_events" "ev"
          WHERE (("ev"."device_id" = "d"."device_id") AND ("ev"."order_id" IS NOT NULL))
          ORDER BY "ev"."occurred_at" DESC
         LIMIT 1) AS "last_order_id"
   FROM (("public"."lock_devices" "d"
     LEFT JOIN "public"."lock_bridges" "b" ON (("b"."bridge_id" = "d"."bridge_id")))
     LEFT JOIN "public"."equipment" "e" ON (("e"."id" = "d"."equipment_id")))
  WHERE "d"."is_active";


ALTER VIEW "public"."lock_device_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lock_jobs" (
    "job_id" "text" NOT NULL,
    "device_id" "text",
    "job_type" integer,
    "job_status" integer,
    "raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lock_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_points" (
    "id" bigint NOT NULL,
    "customer_id" bigint NOT NULL,
    "points_balance" integer DEFAULT 0 NOT NULL,
    "total_points_earned" integer DEFAULT 0 NOT NULL,
    "total_points_redeemed" integer DEFAULT 0 NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_points_points_balance_check" CHECK (("points_balance" >= 0))
);


ALTER TABLE "public"."loyalty_points" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_points" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_points_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loyalty_settings" (
    "id" bigint NOT NULL,
    "points_per_dollar" numeric DEFAULT 10 NOT NULL,
    "points_to_dollar" numeric DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "referral_bonus_points" integer DEFAULT 100 NOT NULL,
    "referral_bonus_dollars" numeric(10,2) DEFAULT 25.00 NOT NULL,
    "referral_bonus_activation_rule" "text" DEFAULT 'completed_booking'::"text" NOT NULL
);


ALTER TABLE "public"."loyalty_settings" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_settings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_settings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loyalty_transactions" (
    "id" bigint NOT NULL,
    "customer_id" bigint NOT NULL,
    "transaction_type" "text" NOT NULL,
    "points_amount" integer NOT NULL,
    "booking_id" bigint,
    "referral_id" bigint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['earned'::"text", 'redeemed'::"text", 'admin_adjustment_add'::"text", 'admin_adjustment_remove'::"text", 'referral_bonus'::"text", 'cancelled'::"text", 'reschedule_adjustment'::"text"])))
);


ALTER TABLE "public"."loyalty_transactions" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_transactions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."magic_link_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "customer_id" bigint NOT NULL,
    "phone" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_id" bigint
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



CREATE TABLE IF NOT EXISTS "public"."protection_plan_claims" (
    "id" bigint NOT NULL,
    "booking_protection_plan_id" bigint NOT NULL,
    "booking_id" bigint NOT NULL,
    "customer_id" bigint,
    "claim_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "claim_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "admin_notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "protection_plan_claims_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."protection_plan_claims" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."protection_plan_claims_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."protection_plan_claims_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."protection_plan_claims_id_seq" OWNED BY "public"."protection_plan_claims"."id";



CREATE TABLE IF NOT EXISTS "public"."protection_plan_services" (
    "id" bigint NOT NULL,
    "protection_plan_id" "uuid" NOT NULL,
    "service_id" integer NOT NULL
);


ALTER TABLE "public"."protection_plan_services" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."protection_plan_services_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."protection_plan_services_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."protection_plan_services_id_seq" OWNED BY "public"."protection_plan_services"."id";



CREATE TABLE IF NOT EXISTS "public"."protection_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_key" "text" NOT NULL,
    "plan_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "price_unit" "text" DEFAULT '/rental'::"text",
    "is_taxable" boolean DEFAULT true NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "info_text" "text",
    "legacy_service_id" integer,
    "legacy_equipment_id" bigint,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "protection_plans_plan_type_check" CHECK (("plan_type" = ANY (ARRAY['rental_insurance'::"text", 'driveway_protection'::"text"])))
);


ALTER TABLE "public"."protection_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_wallet_transactions" (
    "id" bigint NOT NULL,
    "customer_id" bigint NOT NULL,
    "referral_id" bigint,
    "booking_id" bigint,
    "transaction_type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "pending_balance_after" numeric(10,2) DEFAULT 0 NOT NULL,
    "available_balance_after" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referral_wallet_transactions_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "referral_wallet_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['pending_accrual'::"text", 'activated'::"text", 'redeemed'::"text", 'admin_adjustment_add'::"text", 'admin_adjustment_remove'::"text", 'expired'::"text", 'reversed'::"text"])))
);


ALTER TABLE "public"."referral_wallet_transactions" OWNER TO "postgres";


ALTER TABLE "public"."referral_wallet_transactions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."referral_wallet_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" bigint NOT NULL,
    "referrer_customer_id" bigint NOT NULL,
    "referral_code" "text" NOT NULL,
    "referee_email" "text",
    "referee_customer_id" bigint,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "referrer_points_awarded" integer DEFAULT 0 NOT NULL,
    "referee_coupon_code" "text",
    "completed_booking_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "pending_booking_id" bigint,
    "reward_activated_at" timestamp with time zone,
    "referrer_bonus_dollars_awarded" numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'pending_completion'::"text", 'pending_activation'::"text", 'completed'::"text", 'rewarded'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


ALTER TABLE "public"."referrals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."referrals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "lock_deleted_at" timestamp with time zone,
    "lock_confirmed_at" timestamp with time zone,
    "confirm_attempts" integer DEFAULT 0 NOT NULL,
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
    CONSTRAINT "rental_tracking_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['unlock'::"text", 'lock'::"text", 'breakin'::"text", 'pin_generated'::"text", 'admin_override'::"text", 'sync_error'::"text"])))
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
    "original_pickup_time" "text",
    "hours_before_appointment" numeric,
    "previous_status" "text",
    "fee_type" "text",
    "fee_percentage" numeric(10,2),
    "resolved_at" timestamp with time zone,
    "admin_notes" "text"
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
    "video_url" "text",
    "admin_response_text" "text",
    "admin_response_image_urls" "jsonb",
    "admin_response_video_url" "text",
    "admin_response_updated_at" timestamp with time zone,
    "admin_response_updated_by" "uuid",
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reviews"."video_url" IS 'Storage path in customer-uploads bucket for optional video review';



COMMENT ON COLUMN "public"."reviews"."admin_response_text" IS 'Official U-Fill Dumpsters response shown under a customer review.';



COMMENT ON COLUMN "public"."reviews"."admin_response_image_urls" IS 'Storage paths for optional images attached to the official review response.';



COMMENT ON COLUMN "public"."reviews"."admin_response_video_url" IS 'Storage path for optional video attached to the official review response.';



COMMENT ON COLUMN "public"."reviews"."admin_response_updated_at" IS 'Timestamp of the latest official review response update.';



COMMENT ON COLUMN "public"."reviews"."admin_response_updated_by" IS 'Auth user id of the admin who last updated the official review response.';



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



CREATE TABLE IF NOT EXISTS "public"."service_groups" (
    "id" integer NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "defaults" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."service_groups" IS 'Presentation grouping for services (Dumpster Rentals, Trailer Rentals, ...) plus optional shared defaults resolved by public.services_resolved for nullable per-service columns.';



COMMENT ON COLUMN "public"."service_groups"."defaults" IS 'JSONB fallback values consulted by services_resolved when a service leaves the matching column null. Supported keys today: slot_interval_minutes, price_unit, homepage_price_unit, homepage_highlight. Unknown keys are ignored, so this can grow without a migration.';



ALTER TABLE "public"."service_groups" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."service_groups_id_seq"
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



CREATE OR REPLACE VIEW "public"."service_resource_requirements" AS
 SELECT "id",
    "service_id",
    "inventory_item_id",
    "quantity_required",
    "occupancy_model",
    "scheduling_granularity"
   FROM "public"."inventory_rules";


ALTER VIEW "public"."service_resource_requirements" OWNER TO "postgres";


COMMENT ON VIEW "public"."service_resource_requirements" IS 'Forward-looking name for inventory_rules (see design doc phase 2a). A view rather than a rename because inventory_rules is read by name elsewhere; both names resolve to the same rows.';



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
    "delivery_fee" numeric DEFAULT 0,
    "is_taxable" boolean DEFAULT true NOT NULL,
    "delivery_fee_is_taxable" boolean DEFAULT true NOT NULL,
    "mileage_is_taxable" boolean DEFAULT true NOT NULL,
    "show_on_homepage" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "homepage_highlight" "text",
    "customer_pickup" boolean DEFAULT false NOT NULL,
    "delivery_variant_service_id" integer,
    "is_rentable" boolean DEFAULT true NOT NULL,
    "slot_interval_minutes" integer,
    "group_id" integer
);


ALTER TABLE "public"."services" OWNER TO "postgres";


COMMENT ON COLUMN "public"."services"."is_taxable" IS 'Whether the base rental price is subject to sales tax';



COMMENT ON COLUMN "public"."services"."delivery_fee_is_taxable" IS 'Whether the flat delivery fee is taxable';



COMMENT ON COLUMN "public"."services"."mileage_is_taxable" IS 'Whether distance/mileage charges are taxable';



COMMENT ON COLUMN "public"."services"."show_on_homepage" IS 'Show on public booking homepage (Plans + Hero)';



COMMENT ON COLUMN "public"."services"."display_order" IS 'Sort order on homepage (lower first)';



COMMENT ON COLUMN "public"."services"."homepage_highlight" IS 'Optional badge text on plan card (e.g. Our Most Popular Service)';



COMMENT ON COLUMN "public"."services"."customer_pickup" IS 'Customer picks up at yard (self-service rental)';



COMMENT ON COLUMN "public"."services"."delivery_variant_service_id" IS 'When base service offers delivery, points to delivery service row (e.g. 2 -> 4)';



COMMENT ON COLUMN "public"."services"."is_rentable" IS 'False for legacy non-rental rows (e.g. Premium Insurance service id 7).';



COMMENT ON COLUMN "public"."services"."slot_interval_minutes" IS 'Length of one generated booking slot, in minutes. Replaces the hardcoded intervalMap in get-availability.';



COMMENT ON COLUMN "public"."services"."group_id" IS 'Presentation group (Phase 3). Nullable — ungrouped services (e.g. legacy protection-plan row 7) simply render outside any section and never consult group defaults.';



CREATE OR REPLACE VIEW "public"."services_resolved" AS
 SELECT "s"."id",
    "s"."name",
    "s"."description",
    "s"."base_price",
    "s"."price_unit",
    "s"."sale_price",
    "s"."homepage_description",
    "s"."weekly_rate",
    "s"."daily_rate",
    "s"."service_type",
    "s"."homepage_price",
    "s"."homepage_price_unit",
    "s"."features",
    "s"."occupancy_model",
    "s"."mileage_rate",
    "s"."delivery_fee",
    "s"."is_taxable",
    "s"."delivery_fee_is_taxable",
    "s"."mileage_is_taxable",
    "s"."show_on_homepage",
    "s"."display_order",
    "s"."homepage_highlight",
    "s"."customer_pickup",
    "s"."delivery_variant_service_id",
    "s"."is_rentable",
    "s"."slot_interval_minutes",
    "s"."group_id",
    "g"."slug" AS "group_slug",
    "g"."name" AS "group_name",
    "g"."description" AS "group_description",
    "g"."display_order" AS "group_display_order",
    COALESCE("s"."slot_interval_minutes", (("g"."defaults" ->> 'slot_interval_minutes'::"text"))::integer) AS "resolved_slot_interval_minutes",
    COALESCE("s"."price_unit", ("g"."defaults" ->> 'price_unit'::"text")) AS "resolved_price_unit",
    COALESCE("s"."homepage_price_unit", ("g"."defaults" ->> 'homepage_price_unit'::"text")) AS "resolved_homepage_price_unit",
    COALESCE("s"."homepage_highlight", ("g"."defaults" ->> 'homepage_highlight'::"text")) AS "resolved_homepage_highlight"
   FROM ("public"."services" "s"
     LEFT JOIN "public"."service_groups" "g" ON (("g"."id" = "s"."group_id")));


ALTER VIEW "public"."services_resolved" OWNER TO "postgres";


COMMENT ON VIEW "public"."services_resolved" IS 'Phase 3 read model: services left-joined to their service_groups row, with resolved_* columns COALESCING nullable per-service fields over the group''s defaults JSONB. Plain columns (including slot_interval_minutes itself) pass through unchanged so existing consumers of services are unaffected; new code should prefer the resolved_* columns.';



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



CREATE TABLE IF NOT EXISTS "public"."tax_rate_cache" (
    "zip_code" "text" NOT NULL,
    "rate" numeric NOT NULL,
    "jurisdiction" "text",
    "state_rate" numeric,
    "county_rate" numeric,
    "city_rate" numeric,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tax_rate_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."tax_rate_cache" IS 'Cache of ZIP-code sales tax rates from TaxJar. TTL enforced by lookup-tax-rate (30 days).';



COMMENT ON COLUMN "public"."tax_rate_cache"."rate" IS 'Combined state+county+city rate as percentage (e.g. 7.45)';



CREATE TABLE IF NOT EXISTS "public"."tax_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" bigint NOT NULL,
    "tax_amount" numeric NOT NULL,
    "tax_rate" numeric NOT NULL,
    "subtotal_before_tax" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "taxable_subtotal" numeric,
    "non_taxable_subtotal" numeric,
    "line_items" "jsonb",
    "delivery_type" "text",
    "tax_jurisdiction" "text",
    "tax_api_used" "text",
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    CONSTRAINT "tax_records_delivery_type_check" CHECK (("delivery_type" = ANY (ARRAY['delivery'::"text", 'self_service_trailer'::"text", 'self_pickup'::"text"])))
);


ALTER TABLE "public"."tax_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."tax_records" IS 'Audit trail for all tax collections from bookings';



COMMENT ON COLUMN "public"."tax_records"."tax_amount" IS 'Actual tax amount charged in dollars';



COMMENT ON COLUMN "public"."tax_records"."tax_rate" IS 'Tax rate percentage used at time of booking (e.g., 7.45 for 7.45%)';



COMMENT ON COLUMN "public"."tax_records"."subtotal_before_tax" IS 'Subtotal before tax was applied';



COMMENT ON COLUMN "public"."tax_records"."taxable_subtotal" IS 'Subtotal of taxable line items only, after discount';



COMMENT ON COLUMN "public"."tax_records"."non_taxable_subtotal" IS 'Subtotal of non-taxable line items (e.g. insurance)';



COMMENT ON COLUMN "public"."tax_records"."line_items" IS 'Snapshot of charge line items: [{key, label, amount, is_taxable}]';



COMMENT ON COLUMN "public"."tax_records"."delivery_type" IS 'Delivery mode at booking time';



COMMENT ON COLUMN "public"."tax_records"."tax_api_used" IS 'Source of tax rate: business_settings, taxjar, cache, fallback';



COMMENT ON COLUMN "public"."tax_records"."voided_at" IS 'Set when booking is cancelled; excluded from collected-tax totals';



COMMENT ON COLUMN "public"."tax_records"."void_reason" IS 'Why the tax row was voided (e.g. booking cancelled)';



CREATE TABLE IF NOT EXISTS "public"."typing_indicators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "text" NOT NULL,
    "admin_is_typing" boolean DEFAULT false,
    "customer_is_typing" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."typing_indicators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unsubscribe_tokens" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "token" "text" NOT NULL,
    "abandoned_checkout_id" bigint,
    "booking_id" bigint,
    "customer_id" bigint,
    "email" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone
);


ALTER TABLE "public"."unsubscribe_tokens" OWNER TO "postgres";


ALTER TABLE "public"."unsubscribe_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."unsubscribe_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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



ALTER TABLE ONLY "public"."booking_charge_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_charge_transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."booking_fee_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_fee_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."booking_protection_plans" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_protection_plans_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."business_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."business_settings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."charges_and_fees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."charges_and_fees_id_seq"'::"regclass");



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



ALTER TABLE ONLY "public"."protection_plan_claims" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."protection_plan_claims_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."protection_plan_services" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."protection_plan_services_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."service_reminders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."service_reminders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."abandoned_checkouts"
    ADD CONSTRAINT "abandoned_checkouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_knowledge_base"
    ADD CONSTRAINT "ai_knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_knowledge_sections"
    ADD CONSTRAINT "ai_knowledge_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_charge_transactions"
    ADD CONSTRAINT "booking_charge_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_fee_snapshots"
    ADD CONSTRAINT "booking_fee_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_mileage_logs"
    ADD CONSTRAINT "booking_mileage_logs_booking_id_unique" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."booking_mileage_logs"
    ADD CONSTRAINT "booking_mileage_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_booking_id_plan_type_key" UNIQUE ("booking_id", "plan_type");



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_resource_reservations"
    ADD CONSTRAINT "booking_resource_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_settings"
    ADD CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_settings"
    ADD CONSTRAINT "business_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."charges_and_fees"
    ADD CONSTRAINT "charges_and_fees_fee_key_key" UNIQUE ("fee_key");



ALTER TABLE ONLY "public"."charges_and_fees"
    ADD CONSTRAINT "charges_and_fees_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."customer_referral_wallets"
    ADD CONSTRAINT "customer_referral_wallets_pkey" PRIMARY KEY ("customer_id");



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



ALTER TABLE ONLY "public"."feedback_questions"
    ADD CONSTRAINT "feedback_questions_field_key_key" UNIQUE ("field_key");



ALTER TABLE ONLY "public"."feedback_questions"
    ADD CONSTRAINT "feedback_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_tokens"
    ADD CONSTRAINT "feedback_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_tokens"
    ADD CONSTRAINT "feedback_tokens_token_key" UNIQUE ("token");



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



ALTER TABLE ONLY "public"."inventory_rules"
    ADD CONSTRAINT "inventory_rules_service_item_key" UNIQUE ("service_id", "inventory_item_id");



ALTER TABLE ONLY "public"."lock_bridges"
    ADD CONSTRAINT "lock_bridges_pkey" PRIMARY KEY ("bridge_id");



ALTER TABLE ONLY "public"."lock_device_events"
    ADD CONSTRAINT "lock_device_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lock_devices"
    ADD CONSTRAINT "lock_devices_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."lock_jobs"
    ADD CONSTRAINT "lock_jobs_pkey" PRIMARY KEY ("job_id");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_settings"
    ADD CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_customers"
    ADD CONSTRAINT "pending_customers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."pending_customers"
    ADD CONSTRAINT "pending_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protection_plan_claims"
    ADD CONSTRAINT "protection_plan_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protection_plan_services"
    ADD CONSTRAINT "protection_plan_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protection_plan_services"
    ADD CONSTRAINT "protection_plan_services_protection_plan_id_service_id_key" UNIQUE ("protection_plan_id", "service_id");



ALTER TABLE ONLY "public"."protection_plans"
    ADD CONSTRAINT "protection_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protection_plans"
    ADD CONSTRAINT "protection_plans_plan_key_key" UNIQUE ("plan_key");



ALTER TABLE ONLY "public"."referral_wallet_transactions"
    ADD CONSTRAINT "referral_wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referral_code_key" UNIQUE ("referral_code");



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



ALTER TABLE ONLY "public"."service_groups"
    ADD CONSTRAINT "service_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_groups"
    ADD CONSTRAINT "service_groups_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."service_reminders"
    ADD CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_rate_cache"
    ADD CONSTRAINT "tax_rate_cache_pkey" PRIMARY KEY ("zip_code");



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."typing_indicators"
    ADD CONSTRAINT "typing_indicators_conversation_id_key" UNIQUE ("conversation_id");



ALTER TABLE ONLY "public"."typing_indicators"
    ADD CONSTRAINT "typing_indicators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "unique_booking_review" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."equipment_pricing"
    ADD CONSTRAINT "uq_equipment_pricing_equipment_id" UNIQUE ("equipment_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "abandoned_checkouts_booking_id_uidx" ON "public"."abandoned_checkouts" USING "btree" ("booking_id");



CREATE INDEX "abandoned_checkouts_created_at_idx" ON "public"."abandoned_checkouts" USING "btree" ("created_at" DESC);



CREATE INDEX "abandoned_checkouts_email_lower_idx" ON "public"."abandoned_checkouts" USING "btree" ("lower"("email"));



CREATE INDEX "abandoned_checkouts_status_idx" ON "public"."abandoned_checkouts" USING "btree" ("status");



CREATE INDEX "booking_charge_transactions_booking_id_idx" ON "public"."booking_charge_transactions" USING "btree" ("booking_id");



CREATE INDEX "booking_charge_transactions_charge_key_idx" ON "public"."booking_charge_transactions" USING "btree" ("charge_key");



CREATE INDEX "booking_fee_snapshots_booking_id_idx" ON "public"."booking_fee_snapshots" USING "btree" ("booking_id");



CREATE INDEX "booking_fee_snapshots_fee_key_idx" ON "public"."booking_fee_snapshots" USING "btree" ("fee_key");



CREATE INDEX "brr_booking_idx" ON "public"."booking_resource_reservations" USING "btree" ("booking_id");



CREATE INDEX "brr_lookup_idx" ON "public"."booking_resource_reservations" USING "btree" ("resource_id", "reserved_date");



CREATE INDEX "customers_user_id_idx" ON "public"."customers" USING "btree" ("user_id");



CREATE INDEX "idx_ai_assistant_messages_created_at" ON "public"."ai_assistant_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ai_assistant_messages_customer_id" ON "public"."ai_assistant_messages" USING "btree" ("customer_id");



CREATE INDEX "idx_ai_assistant_messages_status" ON "public"."ai_assistant_messages" USING "btree" ("status");



CREATE INDEX "idx_ai_knowledge_base_content" ON "public"."ai_knowledge_base" USING "gin" ("to_tsvector"('"english"'::"regconfig", "content"));



CREATE INDEX "idx_ai_knowledge_base_section_id" ON "public"."ai_knowledge_base" USING "btree" ("section_id");



CREATE INDEX "idx_ai_knowledge_base_title" ON "public"."ai_knowledge_base" USING "gin" ("to_tsvector"('"english"'::"regconfig", "title"));



CREATE INDEX "idx_booking_mileage_logs_customer" ON "public"."booking_mileage_logs" USING "btree" ("customer_id");



CREATE INDEX "idx_booking_mileage_logs_recorded_at" ON "public"."booking_mileage_logs" USING "btree" ("recorded_at" DESC);



CREATE INDEX "idx_booking_mileage_logs_service" ON "public"."booking_mileage_logs" USING "btree" ("service_name");



CREATE INDEX "idx_booking_protection_plans_booking" ON "public"."booking_protection_plans" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_protection_plans_cancelled_at" ON "public"."booking_protection_plans" USING "btree" ("cancelled_at") WHERE ("cancelled_at" IS NOT NULL);



CREATE INDEX "idx_booking_protection_plans_customer" ON "public"."booking_protection_plans" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_checkout_last_seen" ON "public"."bookings" USING "btree" ("checkout_last_seen_at") WHERE ("status" = 'pending_payment'::"text");



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_distance_miles" ON "public"."bookings" USING "btree" ("distance_miles");



CREATE INDEX "idx_chat_messages_conversation_id" ON "public"."chat_messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_chat_messages_created_at" ON "public"."chat_messages" USING "btree" ("created_at");



CREATE INDEX "idx_chat_messages_customer_id" ON "public"."chat_messages" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_booking_id" ON "public"."customer_notes" USING "btree" ("booking_id");



CREATE INDEX "idx_customer_notes_customer_id" ON "public"."customer_notes" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_notes_parent_note_id" ON "public"."customer_notes" USING "btree" ("parent_note_id");



CREATE INDEX "idx_customer_notes_thread_id" ON "public"."customer_notes" USING "btree" ("thread_id");



CREATE INDEX "idx_customers_segment" ON "public"."customers" USING "btree" ("segment");



CREATE INDEX "idx_customers_user_id" ON "public"."customers" USING "btree" ("id");



CREATE INDEX "idx_equipment_inventory_status" ON "public"."equipment_inventory" USING "btree" ("status");



CREATE INDEX "idx_equipment_inventory_type" ON "public"."equipment_inventory" USING "btree" ("equipment_type");



CREATE INDEX "idx_equipment_pricing_created_at" ON "public"."equipment_pricing" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_equipment_pricing_equipment_id" ON "public"."equipment_pricing" USING "btree" ("equipment_id");



CREATE INDEX "idx_equipment_pricing_item_type" ON "public"."equipment_pricing" USING "btree" ("item_type");



CREATE INDEX "idx_feedback_responses_created" ON "public"."feedback_responses" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_feedback_responses_customer" ON "public"."feedback_responses" USING "btree" ("customer_id");



CREATE INDEX "idx_feedback_tokens_booking" ON "public"."feedback_tokens" USING "btree" ("booking_id");



CREATE INDEX "idx_feedback_tokens_customer" ON "public"."feedback_tokens" USING "btree" ("customer_id");



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



CREATE INDEX "idx_lock_device_events_device" ON "public"."lock_device_events" USING "btree" ("device_id", "occurred_at" DESC);



CREATE INDEX "idx_lock_device_events_occurred_at" ON "public"."lock_device_events" USING "btree" ("occurred_at" DESC);



CREATE INDEX "idx_lock_device_events_order_id" ON "public"."lock_device_events" USING "btree" ("order_id");



CREATE INDEX "idx_lock_devices_equipment_id" ON "public"."lock_devices" USING "btree" ("equipment_id");



CREATE INDEX "idx_magic_link_tokens_customer" ON "public"."magic_link_tokens" USING "btree" ("customer_id");



CREATE INDEX "idx_magic_link_tokens_expires" ON "public"."magic_link_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_magic_link_tokens_order_id" ON "public"."magic_link_tokens" USING "btree" ("order_id");



CREATE INDEX "idx_magic_link_tokens_token" ON "public"."magic_link_tokens" USING "btree" ("token");



CREATE INDEX "idx_maintenance_schedule_equipment_id" ON "public"."maintenance_schedule" USING "btree" ("equipment_id");



CREATE INDEX "idx_maintenance_schedule_next_due" ON "public"."maintenance_schedule" USING "btree" ("next_due_date");



CREATE INDEX "idx_pending_customers_booking_id" ON "public"."pending_customers" USING "btree" ("booking_id");



CREATE INDEX "idx_pending_customers_email" ON "public"."pending_customers" USING "btree" ("email");



CREATE UNIQUE INDEX "idx_pending_customers_email_unverified" ON "public"."pending_customers" USING "btree" ("lower"("email")) WHERE (("is_verified" = false) OR ("is_verified" IS NULL));



COMMENT ON INDEX "public"."idx_pending_customers_email_unverified" IS 'Prevents duplicate unverified emails. Allows multiple verified records for audit trail.';



CREATE INDEX "idx_pending_customers_last_seen" ON "public"."pending_customers" USING "btree" ("last_seen_at");



CREATE INDEX "idx_pending_customers_verified" ON "public"."pending_customers" USING "btree" ("is_verified");



CREATE INDEX "idx_protection_plan_claims_booking" ON "public"."protection_plan_claims" USING "btree" ("booking_id");



CREATE INDEX "idx_protection_plan_services_service" ON "public"."protection_plan_services" USING "btree" ("service_id");



CREATE INDEX "idx_protection_plans_type_active" ON "public"."protection_plans" USING "btree" ("plan_type", "is_active");



CREATE INDEX "idx_referral_wallet_transactions_customer_id" ON "public"."referral_wallet_transactions" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "idx_referral_wallet_transactions_referral_id" ON "public"."referral_wallet_transactions" USING "btree" ("referral_id");



CREATE UNIQUE INDEX "idx_referrals_one_time_per_referee_customer" ON "public"."referrals" USING "btree" ("referee_customer_id") WHERE ("referee_customer_id" IS NOT NULL);



CREATE INDEX "idx_referrals_pending_booking_id" ON "public"."referrals" USING "btree" ("pending_booking_id");



CREATE INDEX "idx_rental_access_codes_lock_deleted" ON "public"."rental_access_codes" USING "btree" ("status", "lock_deleted_at") WHERE ("lock_deleted_at" IS NULL);



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



CREATE INDEX "idx_tax_records_voided_at" ON "public"."tax_records" USING "btree" ("voided_at") WHERE ("voided_at" IS NULL);



CREATE INDEX "idx_unsubscribe_tokens_email" ON "public"."unsubscribe_tokens" USING "btree" ("email");



CREATE INDEX "idx_unsubscribe_tokens_token" ON "public"."unsubscribe_tokens" USING "btree" ("token");



CREATE INDEX "idx_user_roles_user_role" ON "public"."user_roles" USING "btree" ("user_id", "role");



CREATE UNIQUE INDEX "lock_device_events_dedup_uidx" ON "public"."lock_device_events" USING "btree" ("device_id", COALESCE("log_type", '-1'::integer), "occurred_at", COALESCE("operation_id", ''::"text"));



CREATE UNIQUE INDEX "loyalty_transactions_cancelled_booking_unique" ON "public"."loyalty_transactions" USING "btree" ("booking_id") WHERE ("transaction_type" = 'cancelled'::"text");



CREATE UNIQUE INDEX "loyalty_transactions_earned_booking_unique" ON "public"."loyalty_transactions" USING "btree" ("booking_id") WHERE (("transaction_type" = 'earned'::"text") AND ("booking_id" IS NOT NULL));



CREATE INDEX "referrals_referral_code_idx" ON "public"."referrals" USING "btree" ("referral_code");



CREATE INDEX "referrals_referrer_customer_id_idx" ON "public"."referrals" USING "btree" ("referrer_customer_id");



CREATE INDEX "rental_access_codes_status_confirmed_idx" ON "public"."rental_access_codes" USING "btree" ("status", "lock_confirmed_at");



CREATE UNIQUE INDEX "rental_tracking_logs_order_event_ts_uidx" ON "public"."rental_tracking_logs" USING "btree" ("order_id", "event_type", "event_timestamp");



CREATE UNIQUE INDEX "tax_records_booking_id_unique" ON "public"."tax_records" USING "btree" ("booking_id");



CREATE OR REPLACE TRIGGER "ai_knowledge_base_updated_at" BEFORE UPDATE ON "public"."ai_knowledge_base" FOR EACH ROW EXECUTE FUNCTION "public"."update_ai_knowledge_updated_at"();



CREATE OR REPLACE TRIGGER "ai_knowledge_sections_updated_at" BEFORE UPDATE ON "public"."ai_knowledge_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_ai_knowledge_updated_at"();



CREATE OR REPLACE TRIGGER "before_customer_insert_generate_id" BEFORE INSERT ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."generate_customer_id"();



CREATE OR REPLACE TRIGGER "bookings_sync_protection_plans" AFTER INSERT OR UPDATE OF "addons" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_sync_booking_protection_plans"();



CREATE OR REPLACE TRIGGER "equipment_inventory_updated_at" BEFORE UPDATE ON "public"."equipment_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."update_equipment_inventory_updated_at"();



CREATE OR REPLACE TRIGGER "financial_categories_updated_at" BEFORE UPDATE ON "public"."financial_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_categories_updated_at"();



CREATE OR REPLACE TRIGGER "financial_expenses_updated_at" BEFORE UPDATE ON "public"."financial_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_expenses_updated_at"();



CREATE OR REPLACE TRIGGER "financial_income_updated_at" BEFORE UPDATE ON "public"."financial_income" FOR EACH ROW EXECUTE FUNCTION "public"."update_financial_income_updated_at"();



CREATE OR REPLACE TRIGGER "financial_projections_updated_at" BEFORE UPDATE ON "public"."financial_projections" FOR EACH ROW EXECUTE FUNCTION "public"."update_maintenance_schedule_updated_at"();



CREATE OR REPLACE TRIGGER "lock_bridges_touch_updated_at" BEFORE UPDATE ON "public"."lock_bridges" FOR EACH ROW EXECUTE FUNCTION "public"."touch_lock_updated_at"();



CREATE OR REPLACE TRIGGER "lock_devices_touch_updated_at" BEFORE UPDATE ON "public"."lock_devices" FOR EACH ROW EXECUTE FUNCTION "public"."touch_lock_updated_at"();



CREATE OR REPLACE TRIGGER "lock_jobs_touch_updated_at" BEFORE UPDATE ON "public"."lock_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_lock_updated_at"();



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



CREATE OR REPLACE TRIGGER "trg_abandoned_checkouts_updated_at" BEFORE UPDATE ON "public"."abandoned_checkouts" FOR EACH ROW EXECUTE FUNCTION "public"."set_abandoned_checkouts_updated_at"();



CREATE OR REPLACE TRIGGER "trg_activate_referral_on_booking_completed" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_booking_completed_referral_activation"();



CREATE OR REPLACE TRIGGER "trg_bookings_loyalty_sync" AFTER UPDATE OF "status", "total_price" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_loyalty_sync_trigger"();



CREATE OR REPLACE TRIGGER "trg_bookings_normalize_time_windows" BEFORE INSERT OR UPDATE OF "drop_off_time_slot", "pickup_time_slot", "plan", "addons" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_booking_time_windows"();



CREATE OR REPLACE TRIGGER "trg_bookings_protection_cancel" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_protection_cancel_trigger"();



CREATE OR REPLACE TRIGGER "trg_bookings_sync_reservations" AFTER INSERT OR UPDATE OF "status", "drop_off_date", "pickup_date", "plan", "addons", "drop_off_window_start", "drop_off_window_end", "pickup_window_start", "pickup_window_end" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_booking_reservations_trigger"();



CREATE OR REPLACE TRIGGER "trg_bookings_tax_ledger" AFTER UPDATE OF "status", "tax_amount", "tax_rate_used", "subtotal_before_tax", "addons" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_tax_ledger_trigger"();



CREATE OR REPLACE TRIGGER "trg_check_booking_inventory" BEFORE INSERT OR UPDATE OF "drop_off_date", "pickup_date", "plan", "addons", "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."check_booking_inventory_capacity"();



CREATE OR REPLACE TRIGGER "trg_notify_feedback_chat_admin_reply" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."notify_feedback_chat_admin_reply"();



CREATE OR REPLACE TRIGGER "trg_pending_customers_normalize_time_windows" BEFORE INSERT OR UPDATE OF "drop_off_time_slot", "pickup_time_slot", "service_id", "delivery_service" ON "public"."pending_customers" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_booking_time_windows"();



CREATE OR REPLACE TRIGGER "trg_promote_customer_segment_on_booking" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."promote_customer_segment_on_booking"();



CREATE OR REPLACE TRIGGER "trigger_cleanup_pending_customers" AFTER INSERT ON "public"."pending_customers" FOR EACH STATEMENT EXECUTE FUNCTION "public"."cleanup_old_pending_customers"();



ALTER TABLE ONLY "public"."abandoned_checkouts"
    ADD CONSTRAINT "abandoned_checkouts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_knowledge_base"
    ADD CONSTRAINT "ai_knowledge_base_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."ai_knowledge_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_charge_transactions"
    ADD CONSTRAINT "booking_charge_transactions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_equipment"
    ADD CONSTRAINT "booking_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_fee_snapshots"
    ADD CONSTRAINT "booking_fee_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_mileage_logs"
    ADD CONSTRAINT "booking_mileage_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_mileage_logs"
    ADD CONSTRAINT "booking_mileage_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_protection_plan_id_fkey" FOREIGN KEY ("protection_plan_id") REFERENCES "public"."protection_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_protection_plans"
    ADD CONSTRAINT "booking_protection_plans_service_id_at_purchase_fkey" FOREIGN KEY ("service_id_at_purchase") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_resource_reservations"
    ADD CONSTRAINT "booking_resource_reservations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_resource_reservations"
    ADD CONSTRAINT "booking_resource_reservations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."inventory_items"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_rescheduled_from_booking_id_fkey" FOREIGN KEY ("rescheduled_from_booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_rescheduled_to_booking_id_fkey" FOREIGN KEY ("rescheduled_to_booking_id") REFERENCES "public"."bookings"("id");



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



ALTER TABLE ONLY "public"."customer_referral_wallets"
    ADD CONSTRAINT "customer_referral_wallets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."feedback_tokens"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_tokens"
    ADD CONSTRAINT "feedback_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_tokens"
    ADD CONSTRAINT "feedback_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."lock_device_events"
    ADD CONSTRAINT "lock_device_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lock_devices"
    ADD CONSTRAINT "lock_devices_bridge_id_fkey" FOREIGN KEY ("bridge_id") REFERENCES "public"."lock_bridges"("bridge_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lock_devices"
    ADD CONSTRAINT "lock_devices_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magic_link_tokens"
    ADD CONSTRAINT "magic_link_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."maintenance_schedule"
    ADD CONSTRAINT "maintenance_schedule_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_inventory"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protection_plan_claims"
    ADD CONSTRAINT "protection_plan_claims_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protection_plan_claims"
    ADD CONSTRAINT "protection_plan_claims_booking_protection_plan_id_fkey" FOREIGN KEY ("booking_protection_plan_id") REFERENCES "public"."booking_protection_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protection_plan_claims"
    ADD CONSTRAINT "protection_plan_claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protection_plan_claims"
    ADD CONSTRAINT "protection_plan_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protection_plan_services"
    ADD CONSTRAINT "protection_plan_services_protection_plan_id_fkey" FOREIGN KEY ("protection_plan_id") REFERENCES "public"."protection_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protection_plan_services"
    ADD CONSTRAINT "protection_plan_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protection_plans"
    ADD CONSTRAINT "protection_plans_legacy_equipment_id_fkey" FOREIGN KEY ("legacy_equipment_id") REFERENCES "public"."equipment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protection_plans"
    ADD CONSTRAINT "protection_plans_legacy_service_id_fkey" FOREIGN KEY ("legacy_service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_wallet_transactions"
    ADD CONSTRAINT "referral_wallet_transactions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_wallet_transactions"
    ADD CONSTRAINT "referral_wallet_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_wallet_transactions"
    ADD CONSTRAINT "referral_wallet_transactions_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_completed_booking_id_fkey" FOREIGN KEY ("completed_booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pending_booking_id_fkey" FOREIGN KEY ("pending_booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referee_customer_id_fkey" FOREIGN KEY ("referee_customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_customer_id_fkey" FOREIGN KEY ("referrer_customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_delivery_variant_service_id_fkey" FOREIGN KEY ("delivery_variant_service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."service_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stripe_payment_info"
    ADD CONSTRAINT "stripe_payment_info_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_abandoned_checkout_id_fkey" FOREIGN KEY ("abandoned_checkout_id") REFERENCES "public"."abandoned_checkouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_image_history"
    ADD CONSTRAINT "verification_image_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."driver_verification_documents"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access booking_charge_transactions" ON "public"."booking_charge_transactions" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access booking_fee_snapshots" ON "public"."booking_fee_snapshots" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access charges_and_fees" ON "public"."charges_and_fees" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access customer_referral_wallets" ON "public"."customer_referral_wallets" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access loyalty_points" ON "public"."loyalty_points" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access loyalty_settings" ON "public"."loyalty_settings" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access loyalty_transactions" ON "public"."loyalty_transactions" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access protection_plan_claims" ON "public"."protection_plan_claims" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access referral_wallet_transactions" ON "public"."referral_wallet_transactions" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access referrals" ON "public"."referrals" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to date_specific_availability" ON "public"."date_specific_availability" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to equipment_inventory" ON "public"."equipment_inventory" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to equipment_pricing" ON "public"."equipment_pricing" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to financial_audit_log" ON "public"."financial_audit_log" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_categories" ON "public"."financial_categories" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_expenses" ON "public"."financial_expenses" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_income" ON "public"."financial_income" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to financial_projections" ON "public"."financial_projections" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to financial_reports" ON "public"."financial_reports" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to lock_bridges" ON "public"."lock_bridges" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to lock_device_events" ON "public"."lock_device_events" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to lock_devices" ON "public"."lock_devices" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to lock_jobs" ON "public"."lock_jobs" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to maintenance_schedule" ON "public"."maintenance_schedule" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin full access to rental_access_codes" ON "public"."rental_access_codes" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to rental_tracking_logs" ON "public"."rental_tracking_logs" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin full access to service_reminders" ON "public"."service_reminders" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin full access to tax_records" ON "public"."tax_records" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin insert abandoned_checkouts" ON "public"."abandoned_checkouts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin select abandoned_checkouts" ON "public"."abandoned_checkouts" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin update abandoned_checkouts" ON "public"."abandoned_checkouts" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin write access on resources" ON "public"."resources" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admin write access to ai_knowledge_base" ON "public"."ai_knowledge_base" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write access to ai_knowledge_sections" ON "public"."ai_knowledge_sections" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write business_settings" ON "public"."business_settings" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admin write protection_plan_services" ON "public"."protection_plan_services" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admin write protection_plans" ON "public"."protection_plans" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Admins can manage all reviews" ON "public"."reviews" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Admins can read all AI assistant messages" ON "public"."ai_assistant_messages" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can update AI assistant messages" ON "public"."ai_assistant_messages" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins manage feedback_questions" ON "public"."feedback_questions" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admins manage feedback_responses" ON "public"."feedback_responses" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"())) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admins read feedback_responses" ON "public"."feedback_responses" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admins read feedback_tokens" ON "public"."feedback_tokens" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Admins read unsubscribe_tokens" ON "public"."unsubscribe_tokens" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Allow admin full access" ON "public"."equipment" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow admin full access" ON "public"."faqs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow admin full access to dump_fees" ON "public"."dump_fees" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Allow admin full access to verification history" ON "public"."verification_image_history" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Allow admins full access to chat_messages" ON "public"."chat_messages" USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Allow admins to select chat_messages" ON "public"."chat_messages" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Allow all for Admin Dashboard" ON "public"."service_availability" USING (("auth"."role"() = 'Admin Dashboard'::"text")) WITH CHECK (("auth"."role"() = 'Admin Dashboard'::"text"));



CREATE POLICY "Allow all for admin" ON "public"."service_availability" USING (("auth"."role"() = 'admin'::"text")) WITH CHECK (("auth"."role"() = 'admin'::"text"));



CREATE POLICY "Allow anonymous read access to date_specific_availability" ON "public"."date_specific_availability" FOR SELECT USING (true);



CREATE POLICY "Allow anonymous read access to dump_fees" ON "public"."dump_fees" FOR SELECT USING (true);



CREATE POLICY "Allow anonymous read access to public reviews" ON "public"."reviews" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Allow anonymous read access to service_groups" ON "public"."service_groups" FOR SELECT USING (true);



CREATE POLICY "Allow anonymous read access to services" ON "public"."services" FOR SELECT USING (true);



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



CREATE POLICY "Anyone can read charges_and_fees" ON "public"."charges_and_fees" FOR SELECT USING (true);



CREATE POLICY "Anyone can read loyalty_settings" ON "public"."loyalty_settings" FOR SELECT USING (true);



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



CREATE POLICY "Customers can read their own AI assistant messages" ON "public"."ai_assistant_messages" FOR SELECT TO "authenticated" USING ((("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"()))) OR "public"."is_admin"()));



CREATE POLICY "Customers can read their own access codes (by booking ownership" ON "public"."rental_access_codes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."customers" "c" ON (("c"."id" = "b"."customer_id")))
  WHERE (("b"."id" = "rental_access_codes"."order_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "Customers can read their own tracking logs" ON "public"."rental_tracking_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     LEFT JOIN "public"."customers" "c" ON (("c"."id" = "b"."customer_id")))
  WHERE (("b"."id" = "rental_tracking_logs"."order_id") AND (("c"."user_id" = "auth"."uid"()) OR ("b"."email" = ("auth"."jwt"() ->> 'email'::"text")))))));



CREATE POLICY "Customers can update own row" ON "public"."customers" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Customers insert own referrals" ON "public"."referrals" FOR INSERT WITH CHECK (("referrer_customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Customers read own booking_charge_transactions" ON "public"."booking_charge_transactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_charge_transactions"."booking_id") AND ("b"."customer_id" = "public"."current_customer_id"())))));



CREATE POLICY "Customers read own booking_fee_snapshots" ON "public"."booking_fee_snapshots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_fee_snapshots"."booking_id") AND ("b"."customer_id" = "public"."current_customer_id"())))));



CREATE POLICY "Customers read own booking_protection_plans" ON "public"."booking_protection_plans" FOR SELECT USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text") OR ("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."user_id" = "auth"."uid"())))));



CREATE POLICY "Customers read own customer_referral_wallets" ON "public"."customer_referral_wallets" FOR SELECT USING (("customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Customers read own loyalty_points" ON "public"."loyalty_points" FOR SELECT USING (("customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Customers read own loyalty_transactions" ON "public"."loyalty_transactions" FOR SELECT USING (("customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Customers read own referral_wallet_transactions" ON "public"."referral_wallet_transactions" FOR SELECT USING (("customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Customers read own referrals" ON "public"."referrals" FOR SELECT USING (("referrer_customer_id" = "public"."current_customer_id"()));



CREATE POLICY "Public can validate magic link tokens" ON "public"."magic_link_tokens" FOR SELECT USING ((("expires_at" > "now"()) AND ("used_at" IS NULL)));



CREATE POLICY "Public read access on resources" ON "public"."resources" FOR SELECT USING (true);



CREATE POLICY "Public read access to ai_knowledge_base" ON "public"."ai_knowledge_base" FOR SELECT USING (true);



CREATE POLICY "Public read access to ai_knowledge_sections" ON "public"."ai_knowledge_sections" FOR SELECT USING (true);



CREATE POLICY "Public read access to equipment_pricing" ON "public"."equipment_pricing" FOR SELECT USING (true);



CREATE POLICY "Public read active protection_plans" ON "public"."protection_plans" FOR SELECT USING ((("is_active" = true) OR "public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Public read business_settings" ON "public"."business_settings" FOR SELECT USING (true);



CREATE POLICY "Public read equipment_inventory" ON "public"."equipment_inventory" FOR SELECT USING (true);



CREATE POLICY "Public read financial_categories" ON "public"."financial_categories" FOR SELECT USING (true);



CREATE POLICY "Public read protection_plan_services" ON "public"."protection_plan_services" FOR SELECT USING (true);



CREATE POLICY "Public read tax_records" ON "public"."tax_records" FOR SELECT USING (true);



CREATE POLICY "Service role full abandoned_checkouts" ON "public"."abandoned_checkouts" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on magic_link_tokens" ON "public"."magic_link_tokens" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to booking_resource_reservations" ON "public"."booking_resource_reservations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to inventory_items" ON "public"."inventory_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to inventory_rules" ON "public"."inventory_rules" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to service_groups" ON "public"."service_groups" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to services" ON "public"."services" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage feedback_tokens" ON "public"."feedback_tokens" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage unsubscribe_tokens" ON "public"."unsubscribe_tokens" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role write booking_protection_plans" ON "public"."booking_protection_plans" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."abandoned_checkouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_assistant_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_knowledge_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_charge_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_equipment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_equipment_admin_all" ON "public"."booking_equipment" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "booking_equipment_select_own" ON "public"."booking_equipment" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_equipment"."booking_id") AND ("b"."customer_id" = "public"."current_customer_id"())))) OR "public"."is_admin"()));



ALTER TABLE "public"."booking_fee_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_mileage_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_mileage_logs_admin_all" ON "public"."booking_mileage_logs" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "booking_mileage_logs_select_own" ON "public"."booking_mileage_logs" FOR SELECT USING ((("customer_id" = "public"."current_customer_id"()) OR "public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."booking_protection_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_resource_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings_admin_delete" ON "public"."bookings" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "bookings_admin_update" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bookings_select_admin" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "bookings_select_own" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("customer_id" = "public"."current_customer_id"()));



ALTER TABLE "public"."business_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."charges_and_fees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_messages_admin_all" ON "public"."contact_messages" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coupons_admin_all" ON "public"."coupons" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "coupons_select_active" ON "public"."coupons" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



ALTER TABLE "public"."customer_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_notes_admin_all" ON "public"."customer_notes" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "customer_notes_insert_own" ON "public"."customer_notes" FOR INSERT TO "authenticated" WITH CHECK (("customer_id" = "public"."current_customer_id"()));



CREATE POLICY "customer_notes_select_own" ON "public"."customer_notes" FOR SELECT TO "authenticated" USING ((("customer_id" = "public"."current_customer_id"()) OR "public"."is_admin"()));



CREATE POLICY "customer_notes_update_own" ON "public"."customer_notes" FOR UPDATE TO "authenticated" USING ((("customer_id" = "public"."current_customer_id"()) OR "public"."is_admin"())) WITH CHECK ((("customer_id" = "public"."current_customer_id"()) OR "public"."is_admin"()));



ALTER TABLE "public"."customer_referral_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_read_own_access_codes" ON "public"."rental_access_codes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."customers" "c" ON (("c"."id" = "b"."customer_id")))
  WHERE (("b"."id" = "rental_access_codes"."order_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "customers_select_admin" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "customers_select_own" ON "public"."customers" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("id" = "public"."current_customer_id"())));



CREATE POLICY "customers_update_admin" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."date_specific_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."driver_verification_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dump_fees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_admin_write" ON "public"."equipment" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."equipment_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_pricing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_public_read" ON "public"."equipment" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."faqs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faqs_public_delete" ON "public"."faqs" FOR DELETE USING (true);



CREATE POLICY "faqs_public_insert" ON "public"."faqs" FOR INSERT WITH CHECK (true);



CREATE POLICY "faqs_public_select" ON "public"."faqs" FOR SELECT USING (true);



CREATE POLICY "faqs_public_update" ON "public"."faqs" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."feedback_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_income" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_projections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_items_admin_all" ON "public"."inventory_items" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."inventory_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_rules_admin_all" ON "public"."inventory_rules" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."lock_bridges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lock_device_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lock_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lock_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_points" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magic_link_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_schedule" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protection_plan_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protection_plan_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protection_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_all_authenticated" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."referral_wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rental_access_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rental_tracking_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reschedule_history_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reschedule_history_logs_admin_all" ON "public"."reschedule_history_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "reschedule_history_logs_customer_insert" ON "public"."reschedule_history_logs" FOR INSERT TO "authenticated" WITH CHECK ("public"."customer_owns_booking"("booking_id"));



CREATE POLICY "reschedule_history_logs_customer_select" ON "public"."reschedule_history_logs" FOR SELECT TO "authenticated" USING ("public"."customer_owns_booking"("booking_id"));



CREATE POLICY "reschedule_history_logs_service_role" ON "public"."reschedule_history_logs" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."resource_access_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resource_access_logs_admin_all" ON "public"."resource_access_logs" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "resource_access_logs_service_role" ON "public"."resource_access_logs" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."resources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_admin_all" ON "public"."reviews" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."service_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_groups_admin_write" ON "public"."service_groups" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."service_reminders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_full_access" ON "public"."tax_rate_cache" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access_bookings" ON "public"."bookings" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access_email_verifications" ON "public"."email_verifications" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access_pending_customers" ON "public"."pending_customers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access_rental_codes" ON "public"."rental_access_codes" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_admin_write" ON "public"."services" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."stripe_payment_info" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stripe_payment_info_admin_all" ON "public"."stripe_payment_info" TO "authenticated" USING (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text"))) WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."tax_rate_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."typing_indicators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "typing_indicators_customer_own" ON "public"."typing_indicators" TO "authenticated" USING ((("conversation_id" = ('cust_'::"text" || ("public"."current_customer_id"())::"text")) OR "public"."is_admin"())) WITH CHECK ((("conversation_id" = ('cust_'::"text" || ("public"."current_customer_id"())::"text")) OR "public"."is_admin"()));



ALTER TABLE "public"."unsubscribe_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_update_own_bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("customer_id" = "public"."current_customer_id"())) WITH CHECK (("customer_id" = "public"."current_customer_id"()));



ALTER TABLE "public"."verification_image_history" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."customer_notes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."rental_tracking_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."typing_indicators";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "booking_creator";











































































































































































REVOKE ALL ON FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_feedback_chat_token_or_error"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."abandoned_checkout_service_tags"("p_service_name" "text", "p_plan" "jsonb", "p_addons" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."abandoned_checkout_service_tags"("p_service_name" "text", "p_plan" "jsonb", "p_addons" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."abandoned_checkout_service_tags"("p_service_name" "text", "p_plan" "jsonb", "p_addons" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_referral_for_completed_booking"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."activate_referral_for_completed_booking"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_referral_for_completed_booking"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_booking_notes_to_customer_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_review_to_customer_notes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."adjust_loyalty_points"("p_customer_id" bigint, "p_points" integer, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_loyalty_points"("p_customer_id" bigint, "p_points" integer, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_referral_wallet"("p_customer_id" bigint, "p_amount" numeric, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_referral_wallet"("p_customer_id" bigint, "p_amount" numeric, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_referral_wallet"("p_customer_id" bigint, "p_amount" numeric, "p_transaction_type" "text", "p_booking_id" bigint, "p_referral_id" bigint, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_adjust_loyalty_points"("p_customer_id" bigint, "p_points_delta" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_adjust_loyalty_points"("p_customer_id" bigint, "p_points_delta" integer, "p_reason" "text") TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";
GRANT INSERT ON TABLE "public"."bookings" TO "booking_creator";



GRANT ALL ON FUNCTION "public"."booking_has_delivery_trip"("p_booking" "public"."bookings") TO "anon";
GRANT ALL ON FUNCTION "public"."booking_has_delivery_trip"("p_booking" "public"."bookings") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_has_delivery_trip"("p_booking" "public"."bookings") TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_is_company_delivery"("p_booking" "public"."bookings") TO "anon";
GRANT ALL ON FUNCTION "public"."booking_is_company_delivery"("p_booking" "public"."bookings") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_is_company_delivery"("p_booking" "public"."bookings") TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_occupied_days"("p_occupancy" "text", "p_drop_off" "date", "p_pickup" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_reservation_rows"("p_service_id" integer, "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_window_start" time without time zone, "p_drop_off_window_end" time without time zone, "p_pickup_window_start" time without time zone, "p_pickup_window_end" time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_status_is_active"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."booking_status_is_active"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_status_is_active"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_status_is_converted"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."booking_status_is_converted"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_status_is_converted"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bookings_loyalty_sync_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."bookings_loyalty_sync_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bookings_loyalty_sync_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bookings_protection_cancel_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."bookings_protection_cancel_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bookings_protection_cancel_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bookings_tax_ledger_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."bookings_tax_ledger_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bookings_tax_ledger_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking_protection_plans"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_booking_inventory_capacity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_abandoned_pending_payment_bookings"("p_older_than" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_magic_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_pending_customers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_points" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_points" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_early_leave_feedback_token"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."create_early_leave_feedback_token"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_early_leave_feedback_token"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_unfinished_booking_from_pending"("p_pending_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint, "p_booking_id" bigint, "p_customer_id" bigint, "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint, "p_booking_id" bigint, "p_customer_id" bigint, "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint, "p_booking_id" bigint, "p_customer_id" bigint, "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_unsubscribe_token"("p_abandoned_checkout_id" bigint, "p_booking_id" bigint, "p_customer_id" bigint, "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_customer_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_customer_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."customer_owns_booking"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."customer_owns_booking"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_owns_booking"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_equipment_quantities"("items_to_decrement" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_unfinished_checkout"("p_booking_id" bigint, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_converted_checkout_sibling"("p_email" "text", "p_exclude_booking_id" bigint, "p_drop_off" "date", "p_pickup" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."find_converted_checkout_sibling"("p_email" "text", "p_exclude_booking_id" bigint, "p_drop_off" "date", "p_pickup" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_converted_checkout_sibling"("p_email" "text", "p_exclude_booking_id" bigint, "p_drop_off" "date", "p_pickup" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval) TO "anon";
GRANT ALL ON FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_stale_unfinished_checkouts"("p_stale_after" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_customer_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_booking_for_post_checkout"("p_booking_id" bigint, "p_payment_intent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_booking_for_post_checkout"("p_booking_id" bigint, "p_payment_intent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_booking_for_post_checkout"("p_booking_id" bigint, "p_payment_intent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_checkout_completion_status"("p_pending_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_checkout_verification_documents"("p_customer_id" bigint, "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_checkout_verification_documents"("p_customer_id" bigint, "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_checkout_verification_documents"("p_customer_id" bigint, "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_feedback_chat_messages"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_feedback_chat_messages"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_feedback_chat_messages"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_feedback_form_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_feedback_form_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_feedback_form_by_token"("p_token" "text") TO "service_role";



GRANT ALL ON TABLE "public"."pending_customers" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_customer_by_id"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_customer_by_id"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_customer_by_id"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_booking_completed_referral_activation"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_booking_completed_referral_activation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_booking_completed_referral_activation"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_financial_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_verification_image_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_booking_delivery_verified"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_booking_delivery_verified"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_booking_delivery_verified"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_customer_feedback_lead"("p_customer_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_customer_feedback_lead"("p_customer_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_customer_feedback_lead"("p_customer_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_booking_time_windows"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_booking_time_windows"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_booking_time_windows"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_feedback_chat_admin_reply"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_feedback_chat_admin_reply"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_feedback_chat_admin_reply"() TO "service_role";



GRANT ALL ON FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."parse_booking_time_slot"("p_slot" "text", "p_span_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."parse_clock_time"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."parse_clock_time"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."parse_clock_time"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."post_feedback_chat_message"("p_token" "text", "p_body" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."post_feedback_chat_message"("p_token" "text", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_feedback_chat_message"("p_token" "text", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_unsubscribe"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_unsubscribe"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_unsubscribe"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_unsubscribe"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_customer_segment_on_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."promote_customer_segment_on_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_customer_segment_on_booking"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reactivate_booking_protection_plans"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_dollars" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."register_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_dollars" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_referral_for_booking"("p_booking_id" bigint, "p_referee_customer_id" bigint, "p_referral_code" "text", "p_bonus_dollars" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_booking_service_id"("p_plan" "jsonb", "p_addons" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_service_id_for_delivery"("p_service_id" integer, "p_is_delivery" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone, "p_slot_end" time without time zone, "p_exclude_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone, "p_slot_end" time without time zone, "p_exclude_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resource_quantity_used"("p_resource_id" integer, "p_date" "date", "p_slot_start" time without time zone, "p_slot_end" time without time zone, "p_exclude_booking_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_booking_loyalty_points"("p_booking_id" bigint, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."server_insert_booking"("p_user_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."service_slot_span_minutes"("p_service_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_abandoned_checkouts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_abandoned_checkouts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_abandoned_checkouts_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."store_pending_booking"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."store_pending_booking"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."store_pending_booking"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_feedback_response"("p_token" "text", "p_answers" "jsonb", "p_comments" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_feedback_response"("p_token" "text", "p_answers" "jsonb", "p_comments" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_feedback_response"("p_token" "text", "p_answers" "jsonb", "p_comments" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_booking_loyalty_to_total"("p_booking_id" bigint, "p_new_total" numeric, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_booking_protection_plans"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_booking_reservations"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_booking_reservations_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_booking_reservations_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_booking_reservations_trigger"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint, "p_pending_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint, "p_pending_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint, "p_pending_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_checkout_presence"("p_booking_id" bigint, "p_pending_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_lock_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_lock_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_lock_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_sync_booking_protection_plans"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_sync_booking_protection_plans"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_sync_booking_protection_plans"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ai_knowledge_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_license_from_checkout"("p_booking_id" bigint, "p_license_plate" "text", "p_license_image_urls" "jsonb", "p_insurance_image" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_license_from_checkout"("p_booking_id" bigint, "p_license_plate" "text", "p_license_image_urls" "jsonb", "p_insurance_image" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_license_from_checkout"("p_booking_id" bigint, "p_license_plate" "text", "p_license_image_urls" "jsonb", "p_insurance_image" "jsonb") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text", "p_set_reminder_sent" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text", "p_set_reminder_sent" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text", "p_set_reminder_sent" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_abandoned_checkout_from_booking"("p_booking_id" bigint, "p_status" "text", "p_set_reminder_sent" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_booking_mileage_log"("p_booking_id" bigint, "p_one_way_miles" numeric, "p_source" "text", "p_address_snapshot" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_booking_mileage_log"("p_booking_id" bigint, "p_one_way_miles" numeric, "p_source" "text", "p_address_snapshot" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_booking_mileage_log"("p_booking_id" bigint, "p_one_way_miles" numeric, "p_source" "text", "p_address_snapshot" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_booking_tax_record"("p_booking_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_pending_customer"("p_email" "text", "p_first_name" "text", "p_last_name" "text", "p_phone" "text", "p_street" "text", "p_city" "text", "p_state" "text", "p_zip" "text", "p_contact_address" "jsonb", "p_delivery_address" "jsonb", "p_drop_off_date" "date", "p_pickup_date" "date", "p_drop_off_time_slot" "text", "p_pickup_time_slot" "text", "p_notes" "text", "p_service_id" integer, "p_plan_data" "jsonb", "p_addons_data" "jsonb", "p_booking_data" "jsonb") TO "service_role";



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



GRANT ALL ON FUNCTION "public"."validate_referral_code"("p_referral_code" "text", "p_referee_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_referral_code"("p_referral_code" "text", "p_referee_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_referral_code"("p_referral_code" "text", "p_referee_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_portal_booking_access"("p_booking_id" bigint, "p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_portal_booking_access"("p_booking_id" bigint, "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_portal_booking_access"("p_booking_id" bigint, "p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."void_booking_tax_records"("p_booking_id" bigint, "p_reason" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."abandoned_checkouts" TO "anon";
GRANT ALL ON TABLE "public"."abandoned_checkouts" TO "authenticated";
GRANT ALL ON TABLE "public"."abandoned_checkouts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."abandoned_checkouts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."abandoned_checkouts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."abandoned_checkouts_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."booking_charge_transactions" TO "anon";
GRANT ALL ON TABLE "public"."booking_charge_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_charge_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_charge_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_charge_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_charge_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_equipment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_equipment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_fee_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."booking_fee_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_fee_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_fee_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_fee_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_fee_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_mileage_logs" TO "anon";
GRANT ALL ON TABLE "public"."booking_mileage_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_mileage_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_mileage_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_mileage_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_mileage_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_protection_plans" TO "anon";
GRANT ALL ON TABLE "public"."booking_protection_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_protection_plans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_protection_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_protection_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_protection_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_resource_reservations" TO "anon";
GRANT ALL ON TABLE "public"."booking_resource_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_resource_reservations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_resource_reservations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_resource_reservations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_resource_reservations_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."charges_and_fees" TO "anon";
GRANT ALL ON TABLE "public"."charges_and_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."charges_and_fees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."charges_and_fees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."charges_and_fees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."charges_and_fees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."contact_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."contact_messages_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupons" TO "anon";
GRANT ALL ON TABLE "public"."coupons" TO "authenticated";
GRANT ALL ON TABLE "public"."coupons" TO "service_role";



GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."coupons_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customer_notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_referral_wallets" TO "anon";
GRANT ALL ON TABLE "public"."customer_referral_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_referral_wallets" TO "service_role";



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



GRANT ALL ON TABLE "public"."feedback_questions" TO "anon";
GRANT ALL ON TABLE "public"."feedback_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_questions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feedback_questions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feedback_questions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_questions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_responses" TO "anon";
GRANT ALL ON TABLE "public"."feedback_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_responses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feedback_responses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feedback_responses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_responses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_tokens" TO "anon";
GRANT ALL ON TABLE "public"."feedback_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feedback_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feedback_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_tokens_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."lock_bridges" TO "authenticated";
GRANT ALL ON TABLE "public"."lock_bridges" TO "service_role";



GRANT ALL ON TABLE "public"."lock_device_events" TO "authenticated";
GRANT ALL ON TABLE "public"."lock_device_events" TO "service_role";



GRANT ALL ON TABLE "public"."lock_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."lock_devices" TO "service_role";



GRANT ALL ON TABLE "public"."lock_device_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."lock_device_presence" TO "service_role";



GRANT ALL ON TABLE "public"."lock_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."lock_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_points" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_points" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_points" TO "service_role";



GRANT ALL ON SEQUENCE "public"."loyalty_points_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_points_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_points_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_settings" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."loyalty_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_transactions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."loyalty_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."magic_link_tokens" TO "anon";
GRANT ALL ON TABLE "public"."magic_link_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."magic_link_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_schedule" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_schedule" TO "service_role";



GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."maintenance_schedule_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protection_plan_claims" TO "anon";
GRANT ALL ON TABLE "public"."protection_plan_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."protection_plan_claims" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protection_plan_claims_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protection_plan_claims_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protection_plan_claims_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protection_plan_services" TO "anon";
GRANT ALL ON TABLE "public"."protection_plan_services" TO "authenticated";
GRANT ALL ON TABLE "public"."protection_plan_services" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protection_plan_services_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protection_plan_services_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protection_plan_services_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protection_plans" TO "anon";
GRANT ALL ON TABLE "public"."protection_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."protection_plans" TO "service_role";



GRANT ALL ON TABLE "public"."referral_wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."referral_wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_wallet_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."referral_wallet_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."referral_wallet_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."referral_wallet_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rental_access_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_access_codes" TO "service_role";



GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "anon";
GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_tracking_logs" TO "service_role";



GRANT ALL ON TABLE "public"."reschedule_history_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."reschedule_history_logs" TO "service_role";



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



GRANT ALL ON TABLE "public"."service_groups" TO "anon";
GRANT ALL ON TABLE "public"."service_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."service_groups" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_groups_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_groups_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_groups_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."service_reminders" TO "anon";
GRANT ALL ON TABLE "public"."service_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."service_reminders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_reminders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."service_resource_requirements" TO "anon";
GRANT ALL ON TABLE "public"."service_resource_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."service_resource_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."services_resolved" TO "anon";
GRANT ALL ON TABLE "public"."services_resolved" TO "authenticated";
GRANT ALL ON TABLE "public"."services_resolved" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_payment_info" TO "anon";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_payment_info" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stripe_payment_info_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tax_rate_cache" TO "anon";
GRANT ALL ON TABLE "public"."tax_rate_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_rate_cache" TO "service_role";



GRANT ALL ON TABLE "public"."tax_records" TO "anon";
GRANT ALL ON TABLE "public"."tax_records" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_records" TO "service_role";



GRANT ALL ON TABLE "public"."typing_indicators" TO "authenticated";
GRANT ALL ON TABLE "public"."typing_indicators" TO "service_role";



GRANT ALL ON TABLE "public"."unsubscribe_tokens" TO "anon";
GRANT ALL ON TABLE "public"."unsubscribe_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."unsubscribe_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."unsubscribe_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."unsubscribe_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."unsubscribe_tokens_id_seq" TO "service_role";



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






























