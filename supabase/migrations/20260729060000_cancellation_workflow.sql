-- Add cancellation_details JSONB to bookings for fee breakdown and approval audit
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_details jsonb;

-- Add cancellation audit fields to reschedule_history_logs
ALTER TABLE public.reschedule_history_logs
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS fee_type text,
  ADD COLUMN IF NOT EXISTS fee_percentage numeric(10,2),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_notes text;
