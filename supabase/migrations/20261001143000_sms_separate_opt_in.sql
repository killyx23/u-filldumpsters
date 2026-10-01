-- Store an explicit marketing SMS choice separately from transactional SMS.
-- Checkout sends both flags on the booking. They are unchecked unless the customer opts in.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sms_marketing_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.sms_opt_in IS
  'Explicit consent for transactional SMS. Written from the booking checkbox. Set false on STOP.';
COMMENT ON COLUMN public.customers.sms_marketing_opt_in IS
  'Explicit consent for marketing SMS. Separate from transactional SMS and from email. Unchecked by default.';

CREATE OR REPLACE FUNCTION public.apply_sms_opt_in_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.customer_id IS NULL OR NEW.addons IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.addons ? 'smsTransactionalOptIn' OR NEW.addons ? 'smsMarketingOptIn' THEN
    UPDATE public.customers
    SET
      sms_opt_in = CASE
        WHEN NEW.addons ? 'smsTransactionalOptIn'
          THEN COALESCE((NEW.addons->>'smsTransactionalOptIn')::boolean, false)
        ELSE sms_opt_in
      END,
      sms_marketing_opt_in = CASE
        WHEN NEW.addons ? 'smsMarketingOptIn'
          THEN COALESCE((NEW.addons->>'smsMarketingOptIn')::boolean, false)
        ELSE sms_marketing_opt_in
      END
    WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS apply_sms_opt_in_after_booking_insert ON public.bookings;

CREATE TRIGGER apply_sms_opt_in_after_booking_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_sms_opt_in_from_booking();
