-- Migration C: Add delivery_type column to bookings.
--
-- Values:
--   'delivery'              – dumpster or dump loader delivered to customer address (plan 1, 4, or plan 2 with isDelivery)
--   'self_service_trailer'  – customer loads the dump loader trailer at their own pace (plan 2 without delivery)
--   'self_pickup'           – customer picks up from business location (future use)
--
-- This column makes the delivery mode explicit and queryable without parsing JSONB,
-- enabling correct tax rate selection (destination-based sourcing in Utah).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS delivery_type text
  CHECK (delivery_type IN ('delivery', 'self_service_trailer', 'self_pickup'));

COMMENT ON COLUMN public.bookings.delivery_type IS 'Delivery mode for this booking: delivery=we bring to customer, self_service_trailer=customer loads at site, self_pickup=customer collects from us. Drives Utah destination-based tax rate selection.';

-- Backfill existing bookings from the addons/plan JSONB fields.
-- Logic mirrors the frontend: isDelivery=true → delivery,
-- plan.id=2 (without isDelivery) → self_service_trailer, else delivery for plan 1/4.
UPDATE public.bookings
  SET delivery_type = CASE
    WHEN (addons->>'isDelivery') IN ('true', 'True', '1')           THEN 'delivery'
    WHEN (plan->>'id')::int = 2
         AND COALESCE((addons->>'isDelivery'), 'false') NOT IN ('true', 'True', '1')
                                                                     THEN 'self_service_trailer'
    WHEN (plan->>'id')::int IN (1, 4)                               THEN 'delivery'
    ELSE 'delivery'
  END
  WHERE delivery_type IS NULL;
