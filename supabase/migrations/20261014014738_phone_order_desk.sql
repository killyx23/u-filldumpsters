-- Phone-order desk records. Public checkout tables and RPCs are unchanged.

CREATE TABLE IF NOT EXISTS public.phone_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_customer_id uuid,
  booking_id bigint,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'waiting_on_customer', 'accepted', 'expired', 'cancelled')),
  agent_user_id uuid,
  agent_email text,
  call_notes text,
  payment_choice text NOT NULL DEFAULT 'customer_link'
    CHECK (payment_choice IN ('customer_link', 'agent_card')),
  sms_consent boolean NOT NULL DEFAULT false,
  read_back_confirmed boolean NOT NULL DEFAULT false,
  link_expires_at timestamptz,
  extended_once boolean NOT NULL DEFAULT false,
  customer_name text,
  customer_email text,
  customer_phone text,
  service_name text,
  total_price numeric,
  verification_skipped boolean NOT NULL DEFAULT false,
  verification_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.phone_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_order_id uuid NOT NULL REFERENCES public.phone_orders(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms', 'both')),
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.phone_order_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_order_id uuid REFERENCES public.phone_orders(id) ON DELETE CASCADE,
  booking_id bigint,
  agent_user_id uuid,
  agent_email text,
  line_key text NOT NULL,
  line_label text NOT NULL,
  amount_before numeric NOT NULL,
  amount_after numeric NOT NULL,
  reason text NOT NULL,
  initials text NOT NULL,
  signature_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_orders_status_idx ON public.phone_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_orders_booking_idx ON public.phone_orders (booking_id);
CREATE INDEX IF NOT EXISTS phone_order_links_order_idx ON public.phone_order_links (phone_order_id);
CREATE INDEX IF NOT EXISTS phone_order_adjustments_order_idx ON public.phone_order_adjustments (phone_order_id, created_at DESC);

ALTER TABLE public.phone_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_order_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_order_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_orders_admin_all ON public.phone_orders;
CREATE POLICY phone_orders_admin_all
  ON public.phone_orders
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS phone_order_links_admin_all ON public.phone_order_links;
CREATE POLICY phone_order_links_admin_all
  ON public.phone_order_links
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS phone_order_adjustments_admin_all ON public.phone_order_adjustments;
CREATE POLICY phone_order_adjustments_admin_all
  ON public.phone_order_adjustments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_order_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_order_adjustments TO authenticated;
GRANT ALL ON public.phone_orders TO service_role;
GRANT ALL ON public.phone_order_links TO service_role;
GRANT ALL ON public.phone_order_adjustments TO service_role;
