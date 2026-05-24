-- Archive metadata for cancelled/rescheduled bookings and reschedule linking
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rescheduled_to_booking_id bigint REFERENCES public.bookings(id),
  ADD COLUMN IF NOT EXISTS rescheduled_from_booking_id bigint REFERENCES public.bookings(id),
  ADD COLUMN IF NOT EXISTS archive_details jsonb;

COMMENT ON COLUMN public.bookings.rescheduled_to_booking_id IS 'When status is Rescheduled, points to the replacement booking.';
COMMENT ON COLUMN public.bookings.rescheduled_from_booking_id IS 'When this booking replaced another, points to the original booking.';
COMMENT ON COLUMN public.bookings.archive_details IS 'Audit trail for cancel/reschedule actions (who, when, original booking info).';
