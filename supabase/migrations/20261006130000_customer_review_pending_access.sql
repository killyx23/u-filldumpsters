-- Customers can submit reviews for the same rentals the portal treats as reviewable,
-- and they can read their own reviews while those reviews are still pending approval.

DROP POLICY IF EXISTS "Customers can create reviews for their own bookings" ON public.reviews;

CREATE POLICY "Customers can create reviews for their own bookings"
  ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.current_customer_id()
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_id
        AND b.customer_id = public.current_customer_id()
        AND (
          b.status IN ('Completed', 'flagged', 'Returned')
          OR b.returned_at IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS "Customers can read their own reviews" ON public.reviews;

CREATE POLICY "Customers can read their own reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());
