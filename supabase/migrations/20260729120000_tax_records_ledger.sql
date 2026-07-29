-- Harden tax_records as durable sales-tax ledger for Financial Books.

ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL;

ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS void_reason text NULL;

COMMENT ON COLUMN public.tax_records.voided_at IS 'Set when booking is cancelled; excluded from collected-tax totals';
COMMENT ON COLUMN public.tax_records.void_reason IS 'Why the tax row was voided (e.g. booking cancelled)';

-- One ledger row per booking
CREATE UNIQUE INDEX IF NOT EXISTS tax_records_booking_id_unique
  ON public.tax_records (booking_id);

CREATE INDEX IF NOT EXISTS idx_tax_records_voided_at
  ON public.tax_records (voided_at)
  WHERE voided_at IS NULL;

-- Upsert helper used by triggers / service role
CREATE OR REPLACE FUNCTION public.upsert_booking_tax_record(p_booking_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.void_booking_tax_records(p_booking_id bigint, p_reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.bookings_tax_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_bookings_tax_ledger ON public.bookings;
CREATE TRIGGER trg_bookings_tax_ledger
  AFTER UPDATE OF status, tax_amount, tax_rate_used, subtotal_before_tax, addons ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_tax_ledger_trigger();

REVOKE ALL ON FUNCTION public.upsert_booking_tax_record(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_booking_tax_records(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_booking_tax_record(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_booking_tax_records(bigint, text) TO service_role;

-- Backfill ledger from bookings that have tax recorded
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT b.id
      FROM public.bookings b
     WHERE COALESCE(b.tax_amount, 0) > 0
        OR COALESCE(b.tax_rate_used, 0) > 0
  LOOP
    PERFORM public.upsert_booking_tax_record(r.id);
  END LOOP;
END;
$$;

-- Ensure cancelled bookings are voided
UPDATE public.tax_records tr
   SET voided_at = COALESCE(tr.voided_at, timezone('utc', now())),
       void_reason = COALESCE(tr.void_reason, 'Booking cancelled')
  FROM public.bookings b
 WHERE tr.booking_id = b.id
   AND b.status = 'Cancelled'
   AND tr.voided_at IS NULL;
