ALTER TABLE public.magic_link_tokens
ADD COLUMN IF NOT EXISTS order_id bigint;

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_order_id
ON public.magic_link_tokens (order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'magic_link_tokens_order_id_fkey'
  ) THEN
    ALTER TABLE public.magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_order_id_fkey
    FOREIGN KEY (order_id)
    REFERENCES public.bookings(id)
    ON DELETE CASCADE;
  END IF;
END;
$$;
