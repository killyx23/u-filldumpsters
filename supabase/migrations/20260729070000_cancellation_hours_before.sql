-- Persist hours between cancel request and appointment for cancellation audit/UI
ALTER TABLE public.reschedule_history_logs
  ADD COLUMN IF NOT EXISTS hours_before_appointment numeric;
