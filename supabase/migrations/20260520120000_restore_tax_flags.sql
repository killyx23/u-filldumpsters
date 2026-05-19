-- Restore per-charge tax flags and booking tax persistence (reverted by 20260519155036_remote_schema)

-- services: per-line taxability flags
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_taxable boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS delivery_fee_is_taxable boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS mileage_is_taxable boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN public.services.is_taxable IS 'Whether the base rental price is subject to sales tax';
COMMENT ON COLUMN public.services.delivery_fee_is_taxable IS 'Whether the flat delivery fee is taxable';
COMMENT ON COLUMN public.services.mileage_is_taxable IS 'Whether distance/mileage charges are taxable';

-- equipment_pricing: tax flag per item
ALTER TABLE public.equipment_pricing
  ADD COLUMN IF NOT EXISTS is_taxable boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN public.equipment_pricing.is_taxable IS 'Whether this equipment/item is subject to sales tax';

-- tax_records: extended audit columns
ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS non_taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS line_items jsonb;

COMMENT ON COLUMN public.tax_records.taxable_subtotal IS 'Subtotal of taxable line items only, after discount';
COMMENT ON COLUMN public.tax_records.non_taxable_subtotal IS 'Subtotal of non-taxable line items (e.g. insurance)';
COMMENT ON COLUMN public.tax_records.line_items IS 'Snapshot of charge line items: [{key, label, amount, is_taxable}]';

-- Premium Insurance service (services.id = 7) is non-taxable in Utah
UPDATE public.services SET is_taxable = false WHERE id = 7;

-- equipment_pricing row for insurance (equipment_id 7) if present
UPDATE public.equipment_pricing SET is_taxable = false WHERE equipment_id = 7;

-- Driveway protection setting: ensure JSON supports is_taxable
UPDATE public.business_settings
SET setting_value = COALESCE(setting_value, '{}'::jsonb) || jsonb_build_object(
  'price', COALESCE((setting_value->>'price')::numeric, 15),
  'is_taxable', COALESCE((setting_value->>'is_taxable')::boolean, true)
)
WHERE setting_key = 'driveway_protection_price'
  AND setting_value IS NOT NULL;

-- Persist tax fields when creating pending bookings
CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
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
    COALESCE((payload->>'subtotal_before_tax')::numeric, 0),
    COALESCE((payload->>'tax_amount')::numeric, 0),
    COALESCE((payload->>'tax_rate_used')::numeric, 0),
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
END;
$$;
