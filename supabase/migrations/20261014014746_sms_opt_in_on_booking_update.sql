-- Keep the customer profile matched when a booking's text choices are written or rewritten.
-- The website screens are unchanged. Phone acceptance and payment both update bookings.addons.

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

DROP TRIGGER IF EXISTS apply_sms_opt_in_after_booking_update ON public.bookings;

CREATE TRIGGER apply_sms_opt_in_after_booking_update
  AFTER UPDATE OF addons ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_sms_opt_in_from_booking();
