ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pending_address jsonb,
  ADD COLUMN IF NOT EXISTS address_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.customers.pending_address IS
  'Address submitted by the customer and waiting for customer-service approval. Live street, city, state, and zip stay unchanged until approved.';

COMMENT ON COLUMN public.customers.address_history IS
  'Recorded addresses for the customer: original order address, reschedule changes, and profile changes, including approval status.';
