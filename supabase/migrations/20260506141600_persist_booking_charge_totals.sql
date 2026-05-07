-- Persist finalized charge lines before Stripe PaymentIntent creation.
-- Reuses existing bookings columns: subtotal_before_tax, tax_amount, tax_rate_used, total_price.

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
    subtotal_before_tax,
    tax_amount,
    tax_rate_used,
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
    COALESCE(NULLIF(payload->>'subtotal_before_tax', '')::numeric, (payload->>'total_price')::numeric, 0),
    COALESCE(NULLIF(payload->>'tax_amount', '')::numeric, 0),
    COALESCE(NULLIF(payload->>'tax_rate_used', '')::numeric, 7.45),
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

-- Preserve actual charged totals on existing rows that have a total but missing subtotal.
UPDATE public.bookings
SET subtotal_before_tax = GREATEST(
  0,
  COALESCE(total_price, 0)::numeric - COALESCE(tax_amount, 0)::numeric
)
WHERE COALESCE(total_price, 0) > 0
  AND COALESCE(subtotal_before_tax, 0) = 0;
