-- A saved phone call that is not ready to send. No booking is created until the agent sends the link.

ALTER TABLE public.phone_orders
  ADD COLUMN IF NOT EXISTS draft_payload jsonb;
