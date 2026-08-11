-- Let portal customers read lock/unlock history for their own bookings.
-- The legacy policy matched only bookings.email = jwt email; portal auth is
-- keyed off customers.user_id, so ownership via customer_id must be allowed too.

DROP POLICY IF EXISTS "Customers can read their own tracking logs" ON public.rental_tracking_logs;

CREATE POLICY "Customers can read their own tracking logs"
  ON public.rental_tracking_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      LEFT JOIN public.customers c ON c.id = b.customer_id
      WHERE b.id = rental_tracking_logs.order_id
        AND (
          c.user_id = auth.uid()
          OR b.email = (auth.jwt() ->> 'email')
        )
    )
  );
