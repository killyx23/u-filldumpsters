-- Paid checkout decrements equipment.total_quantity, then clears
-- addons.equipment_hold_active so an abandoned unpaid checkout cannot restock a
-- booking that was actually paid. Cancellation of that paid booking never put the
-- units back, so rental stock (wheelbarrow, hand truck) stayed at 0 after the
-- refund email.
--
-- Reschedule already rewrites booking_resource_reservations when the service
-- dates change. Rental add-ons are a separate counter: a unit checked out for
-- the new dates must stay out of stock on those dates, and must be bookable on
-- the days the customer is no longer using.

-- ---------------------------------------------------------------------------
-- Never let checkout drive stock below zero
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_equipment_quantities(items_to_decrement jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_record jsonb;
  item_id bigint;
  qty_to_subtract int;
  available int;
  item_name text;
BEGIN
  FOR item_record IN SELECT * FROM jsonb_array_elements(items_to_decrement)
  LOOP
    item_id := (item_record->>'equipment_id')::bigint;
    qty_to_subtract := (item_record->>'quantity')::int;

    IF item_id IS NULL OR qty_to_subtract IS NULL OR qty_to_subtract <= 0 THEN
      CONTINUE;
    END IF;

    SELECT e.total_quantity, e.name
      INTO available, item_name
      FROM public.equipment e
     WHERE e.id = item_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Equipment id % was not found.', item_id
        USING ERRCODE = 'P0001',
              DETAIL = 'equipment_not_found';
    END IF;

    IF available < qty_to_subtract THEN
      RAISE EXCEPTION '"%" is out of stock: requested %, available %.',
        coalesce(item_name, 'Equipment'), qty_to_subtract, available
        USING ERRCODE = 'P0001',
              DETAIL = 'equipment_insufficient_stock',
              HINT = coalesce(item_name, 'Equipment');
    END IF;

    UPDATE public.equipment
       SET total_quantity = total_quantity - qty_to_subtract
     WHERE id = item_id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.decrement_equipment_quantities(jsonb) IS
  'Subtracts rental/consumable quantities at checkout. Refuses the update when '
  'requested quantity would drive total_quantity below zero.';

-- ---------------------------------------------------------------------------
-- Restock equipment still out on a cancelled booking
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_cancelled_booking_equipment(
  p_booking_id bigint,
  p_previous_status text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_blocked boolean;
  v_previous text := lower(coalesce(p_previous_status, ''));
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF lower(coalesce(v_booking.status, '')) NOT IN ('cancelled', 'canceled') THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT be.id AS booking_equipment_id,
           be.equipment_id,
           be.quantity,
           e.name,
           e.type
      FROM public.booking_equipment be
      JOIN public.equipment e ON e.id = be.equipment_id
     WHERE be.booking_id = p_booking_id
       AND be.returned_at IS NULL
       AND e.type IN ('rental', 'consumable')
  LOOP
    v_blocked := EXISTS (
      SELECT 1
        FROM jsonb_each(coalesce(v_booking.return_issues, '{}'::jsonb)) issue
       WHERE issue.value->>'status' IN (
               'damaged', 'lost_stolen', 'not_returned', 'not_returned_fee_charged'
             )
         AND lower(issue.key) IN (
               lower(v_row.name),
               CASE v_row.equipment_id
                 WHEN 1 THEN 'wheelbarrow'
                 WHEN 2 THEN 'hand truck'
                 WHEN 3 THEN 'working gloves (pair)'
               END,
               CASE v_row.equipment_id
                 WHEN 1 THEN 'gorilla heavy-duty dump cart'
                 WHEN 2 THEN '3-in-1 convertible hand truck'
                 WHEN 3 THEN 'gloves'
               END
             )
    );
    IF v_blocked THEN
      CONTINUE;
    END IF;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'equipment_id', v_row.equipment_id,
        'quantity', greatest(coalesce(v_row.quantity, 1), 1)
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) > 0 THEN
    PERFORM public.increment_equipment_quantities(v_items);

    UPDATE public.booking_equipment be
       SET returned_at = now()
     WHERE be.booking_id = p_booking_id
       AND be.returned_at IS NULL
       AND be.equipment_id IN (
         SELECT (item->>'equipment_id')::bigint
           FROM jsonb_array_elements(v_items) item
       );

    RETURN jsonb_array_length(v_items);
  END IF;

  -- Rows already exist (returned, or held back as damaged/lost). Do not also
  -- restock from the add-on JSON, or a returned unit would be counted twice.
  IF EXISTS (
    SELECT 1 FROM public.booking_equipment WHERE booking_id = p_booking_id
  ) THEN
    RETURN 0;
  END IF;

  -- Paid bookings clear equipment_hold_active without restocking. Unpaid
  -- teardown sets that flag false and already incremented stock, and those
  -- rows usually never get booking_equipment. Only rebuild from add-on JSON
  -- when this cancel is not that already-released unpaid path.
  IF coalesce(v_booking.addons->>'equipment_released_on_cancel', '') = 'true' THEN
    RETURN 0;
  END IF;
  -- Unpaid teardown already incremented stock and set this flag false.
  IF coalesce(v_booking.addons->>'equipment_hold_active', '') = 'false'
     AND v_previous IN ('pending_payment', 'booking_not_finished') THEN
    RETURN 0;
  END IF;

  v_items := '[]'::jsonb;
  FOR v_row IN
    SELECT e.id AS equipment_id,
           greatest(coalesce((item->>'quantity')::int, 1), 1) AS quantity
      FROM jsonb_array_elements(coalesce(v_booking.addons->'equipment', '[]'::jsonb)) item
      JOIN public.equipment e
        ON e.id = coalesce(
             CASE WHEN coalesce(item->>'dbId', '') ~ '^\d+$' THEN (item->>'dbId')::bigint END,
             CASE WHEN coalesce(item->>'equipment_id', '') ~ '^\d+$' THEN (item->>'equipment_id')::bigint END,
             CASE lower(coalesce(item->>'id', ''))
               WHEN 'wheelbarrow' THEN 1
               WHEN 'handtruck' THEN 2
               WHEN 'gloves' THEN 3
               ELSE CASE
                 WHEN coalesce(item->>'id', '') ~ '^\d+$' THEN (item->>'id')::bigint
               END
             END
           )
     WHERE e.type IN ('rental', 'consumable')
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'equipment_id', v_row.equipment_id,
        'quantity', v_row.quantity
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM public.increment_equipment_quantities(v_items);

  UPDATE public.bookings
     SET addons = coalesce(addons, '{}'::jsonb) || jsonb_build_object('equipment_released_on_cancel', true)
   WHERE id = p_booking_id;

  RETURN jsonb_array_length(v_items);
END;
$$;

COMMENT ON FUNCTION public.release_cancelled_booking_equipment(bigint, text) IS
  'Puts rental and consumable equipment back in stock after a booking is cancelled. '
  'Idempotent: booking_equipment.returned_at marks units already restocked. '
  'Damaged or lost items are left out of stock. Paid bookings are included even '
  'though equipment_hold_active was cleared at payment.';

CREATE OR REPLACE FUNCTION public.release_equipment_when_booking_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('cancelled', 'canceled')
     AND lower(coalesce(OLD.status, '')) NOT IN ('cancelled', 'canceled')
  THEN
    PERFORM public.release_cancelled_booking_equipment(NEW.id, OLD.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_equipment_on_cancel ON public.bookings;
CREATE TRIGGER trg_release_equipment_on_cancel
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.release_equipment_when_booking_cancelled();

-- ---------------------------------------------------------------------------
-- Date-aware rental availability
-- total_quantity is units not checked out to anyone. A rental checked out for
-- other dates is added back when the requested window does not overlap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_quantity_available(
  p_equipment_id bigint,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL,
  p_exclude_booking_id bigint DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN e.id IS NULL THEN 0
    WHEN e.type IS DISTINCT FROM 'rental' OR p_start IS NULL OR p_end IS NULL
      THEN coalesce(e.total_quantity, 0)
    ELSE coalesce(e.total_quantity, 0) + coalesce((
      SELECT sum(be.quantity)::integer
        FROM public.booking_equipment be
        JOIN public.bookings b ON b.id = be.booking_id
       WHERE be.equipment_id = e.id
         AND be.returned_at IS NULL
         AND public.booking_status_is_active(b.status)
         AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
         AND NOT (
           b.drop_off_date <= p_end
           AND coalesce(b.pickup_date, b.drop_off_date) >= p_start
         )
    ), 0)
  END
  FROM public.equipment e
  WHERE e.id = p_equipment_id;
$$;

COMMENT ON FUNCTION public.equipment_quantity_available(bigint, date, date, bigint) IS
  'How many of this equipment item can be booked for [p_start, p_end]. '
  'Rentals checked out on a different set of days count as free for this window. '
  'Non-rentals, and calls without dates, return the on-hand total_quantity.';

CREATE OR REPLACE FUNCTION public.equipment_inventory_snapshot(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL,
  p_exclude_booking_id bigint DEFAULT NULL
) RETURNS TABLE (
  id bigint,
  name text,
  type text,
  total_quantity integer,
  available_quantity integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id,
         e.name,
         e.type,
         e.total_quantity,
         public.equipment_quantity_available(e.id, p_start, p_end, p_exclude_booking_id)
    FROM public.equipment e
   ORDER BY e.type, e.name;
$$;

REVOKE ALL ON FUNCTION public.release_cancelled_booking_equipment(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_cancelled_booking_equipment(bigint, text) TO service_role;

REVOKE ALL ON FUNCTION public.release_equipment_when_booking_cancelled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_equipment_when_booking_cancelled() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.equipment_quantity_available(bigint, date, date, bigint)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.equipment_inventory_snapshot(date, date, bigint)
  TO anon, authenticated, service_role;

-- Time-only reschedules change the slot text. The BEFORE window normalizer
-- rewrites the typed windows, but the reservation sync trigger previously
-- ignored a time-slot-only update, so the old window stayed reserved.
DROP TRIGGER IF EXISTS trg_bookings_sync_reservations ON public.bookings;
CREATE TRIGGER trg_bookings_sync_reservations
  AFTER INSERT OR UPDATE OF
    status, drop_off_date, pickup_date, plan, addons,
    drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end,
    drop_off_time_slot, pickup_time_slot
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_reservations_trigger();

-- Bookings already cancelled (refund email sent, stock still at 0).
DO $$
DECLARE
  v_id bigint;
BEGIN
  FOR v_id IN
    SELECT DISTINCT b.id
      FROM public.bookings b
      JOIN public.booking_equipment be ON be.booking_id = b.id
     WHERE lower(b.status) IN ('cancelled', 'canceled')
       AND be.returned_at IS NULL
  LOOP
    PERFORM public.release_cancelled_booking_equipment(v_id, NULL);
  END LOOP;

  -- Paid cancels that never got a booking_equipment row still took stock at checkout.
  FOR v_id IN
    SELECT b.id
      FROM public.bookings b
     WHERE lower(b.status) IN ('cancelled', 'canceled')
       AND coalesce(b.addons->>'equipment_released_on_cancel', '') <> 'true'
       AND jsonb_typeof(b.addons->'equipment') = 'array'
       AND jsonb_array_length(b.addons->'equipment') > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.booking_equipment be WHERE be.booking_id = b.id
       )
       AND EXISTS (
         SELECT 1 FROM public.stripe_payment_info spi WHERE spi.booking_id = b.id
       )
  LOOP
    PERFORM public.release_cancelled_booking_equipment(v_id, 'confirmed');
  END LOOP;
END $$;

-- Rebuild service/trailer reservations so a cancelled booking holds no days
-- and a rescheduled booking holds only its current dates.
DO $$
DECLARE
  v_id bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'sync_booking_reservations'
  ) THEN
    FOR v_id IN SELECT id FROM public.bookings LOOP
      PERFORM public.sync_booking_reservations(v_id);
    END LOOP;
  END IF;
END $$;
