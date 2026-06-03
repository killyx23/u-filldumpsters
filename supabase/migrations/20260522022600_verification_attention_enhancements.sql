-- Additive fields for verification/charge workflow, chat severity, and receipt history snapshots.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_delta_details jsonb,
  ADD COLUMN IF NOT EXISTS charge_outcome_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_original_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS receipt_status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS message_severity text,
  ADD COLUMN IF NOT EXISTS message_context jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_messages_message_severity_check'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_message_severity_check
      CHECK (message_severity IS NULL OR message_severity IN ('success', 'warning', 'urgent', 'info'));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.payment_delta_details IS 'Structured data about amount differences that require additional charge approval.';
COMMENT ON COLUMN public.bookings.charge_outcome_history IS 'Audit array of charge attempts, cancellations, and manual captures.';
COMMENT ON COLUMN public.bookings.receipt_original_snapshot IS 'Immutable first receipt snapshot for legal/historical comparison.';
COMMENT ON COLUMN public.bookings.receipt_status_history IS 'Status/timeline snapshots appended whenever booking state materially changes.';
COMMENT ON COLUMN public.chat_messages.message_severity IS 'Optional semantic severity: success, warning, urgent, info.';
COMMENT ON COLUMN public.chat_messages.message_context IS 'Optional structured metadata associated with system/admin status messages.';
