-- Teach validate_coupon about rental duration and return the rules payload.
--
-- The function keeps its existing validity checks (active, not expired, under
-- usage limit, service match) and now also:
--   * accepts an optional rental_days_arg so callers can pass the rental length
--   * returns the coupon's coupon_kind and rules array so the client/server rule
--     evaluator (src/utils/couponRules.js) can resolve the actual benefit.
--
-- Rental-length matching itself is performed by the shared evaluator rather than
-- in SQL, so pricing stays identical across the booking page, totals util, and
-- finalize-booking. rental_days_arg is accepted for forward compatibility and to
-- allow a future hard gate (e.g. "coupon requires >= N days") without another
-- signature change.

-- Drop the old 2-arg signature so the new default-arg version is unambiguous.
DROP FUNCTION IF EXISTS public.validate_coupon(text, integer);

CREATE OR REPLACE FUNCTION public.validate_coupon(
    coupon_code text,
    service_id_arg integer,
    rental_days_arg integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
        'discountValue', coupon_record.discount_value,
        'couponKind', COALESCE(coupon_record.coupon_kind, 'flat'),
        'rules', COALESCE(coupon_record.rules, '[]'::jsonb)
    );
END;
$$;

ALTER FUNCTION public.validate_coupon(text, integer, integer) OWNER TO postgres;
GRANT ALL ON FUNCTION public.validate_coupon(text, integer, integer) TO anon;
GRANT ALL ON FUNCTION public.validate_coupon(text, integer, integer) TO authenticated;
GRANT ALL ON FUNCTION public.validate_coupon(text, integer, integer) TO service_role;
