-- Add left_early status for leave/cancel checkout CRM leads

ALTER TABLE public.abandoned_checkouts
  DROP CONSTRAINT IF EXISTS abandoned_checkouts_status_check;

ALTER TABLE public.abandoned_checkouts
  ADD CONSTRAINT abandoned_checkouts_status_check
  CHECK (status IN ('open', 'reminded', 'expired', 'converted', 'unsubscribed', 'left_early'));

-- Upsert: set source from status when left_early; keep other sources as pending_payment
CREATE OR REPLACE FUNCTION public.upsert_abandoned_checkout_from_booking(
  p_booking_id bigint,
  p_status text DEFAULT 'expired',
  p_set_reminder_sent boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  v_service_name text;
  v_id bigint;
  v_cart jsonb;
  v_source text;
BEGIN
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
    WHEN p_status = 'left_early' THEN 'left_early'
    ELSE 'pending_payment'
  END;

  v_service_name := COALESCE(
    NULLIF(b.plan->>'name', ''),
    NULLIF(b.plan->'name'->>'name', ''),
    'Service'
  );

  v_cart := jsonb_build_object(
    'booking_id', b.id,
    'plan', b.plan,
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
    meta
  )
  VALUES (
    lower(trim(b.email)),
    NULLIF(b.phone, ''),
    NULLIF(trim(COALESCE(b.name, concat_ws(' ', b.first_name, b.last_name))), ''),
    v_source,
    b.id,
    v_service_name,
    b.plan,
    b.addons,
    v_cart,
    b.total_price,
    b.drop_off_date::date,
    b.pickup_date::date,
    p_status,
    CASE WHEN p_set_reminder_sent THEN now() ELSE NULL END,
    CASE WHEN p_status = 'expired' THEN now() ELSE NULL END,
    true,
    jsonb_build_object('last_source_status', b.status)
  )
  ON CONFLICT (booking_id)
  DO UPDATE SET
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, ac.phone),
    full_name = COALESCE(EXCLUDED.full_name, ac.full_name),
    source = CASE
      WHEN EXCLUDED.source = 'left_early' THEN EXCLUDED.source
      ELSE COALESCE(ac.source, EXCLUDED.source)
    END,
    service_name = COALESCE(EXCLUDED.service_name, ac.service_name),
    plan = COALESCE(EXCLUDED.plan, ac.plan),
    addons = COALESCE(EXCLUDED.addons, ac.addons),
    cart_snapshot = COALESCE(EXCLUDED.cart_snapshot, ac.cart_snapshot),
    total_price = COALESCE(EXCLUDED.total_price, ac.total_price),
    drop_off_date = COALESCE(EXCLUDED.drop_off_date, ac.drop_off_date),
    pickup_date = COALESCE(EXCLUDED.pickup_date, ac.pickup_date),
    status = CASE
      WHEN ac.status = 'unsubscribed' THEN ac.status
      WHEN ac.status = 'converted' THEN ac.status
      ELSE EXCLUDED.status
    END,
    reminder_sent_at = CASE
      WHEN p_set_reminder_sent THEN COALESCE(ac.reminder_sent_at, now())
      ELSE ac.reminder_sent_at
    END,
    expired_at = CASE
      WHEN p_status = 'expired' THEN COALESCE(ac.expired_at, now())
      ELSE ac.expired_at
    END,
    meta = COALESCE(ac.meta, '{}'::jsonb) || EXCLUDED.meta,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
