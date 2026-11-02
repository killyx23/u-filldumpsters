-- Optional manual override for the Financial Books credit card fee total.
-- Null means keep using 2.9% of each order plus $0.30.

CREATE TABLE IF NOT EXISTS public.financial_book_settings (
  id integer PRIMARY KEY DEFAULT 1,
  credit_card_fee_override numeric(12, 2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_book_settings_singleton CHECK (id = 1),
  CONSTRAINT financial_book_settings_card_fee_check CHECK (
    credit_card_fee_override IS NULL OR credit_card_fee_override >= 0
  )
);

INSERT INTO public.financial_book_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.financial_book_settings IS
  'Financial Books adjustments. credit_card_fee_override replaces the calculated card-fee total when set.';

ALTER TABLE public.financial_book_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_book_settings_admin_all ON public.financial_book_settings;
CREATE POLICY financial_book_settings_admin_all
  ON public.financial_book_settings
  FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public.financial_book_settings TO authenticated, service_role;
