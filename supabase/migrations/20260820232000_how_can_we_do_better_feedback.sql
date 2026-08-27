-- How can we do better: customer segments, survey questions, tokens, responses

-- ---------------------------------------------------------------------------
-- customers.segment: booked (paid) vs feedback_lead (abandoned / left early)
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'booked';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_segment_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_segment_check
  CHECK (segment = ANY (ARRAY['booked'::text, 'feedback_lead'::text]));

COMMENT ON COLUMN public.customers.segment IS
  'booked = completed at least one paid booking; feedback_lead = left/abandoned without booking';

CREATE INDEX IF NOT EXISTS idx_customers_segment ON public.customers (segment);

-- Backfill: anyone without a non-cancelled paid-ish booking becomes feedback_lead
UPDATE public.customers c
SET segment = 'feedback_lead'
WHERE c.segment = 'booked'
  AND NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = c.id
      AND b.status IS NOT NULL
      AND lower(b.status) NOT IN (
        'pending_payment',
        'cancelled',
        'canceled'
      )
  );

-- New bookings: create as feedback_lead until payment promotes to booked
CREATE OR REPLACE FUNCTION public.handle_new_booking() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
  address_verification_skipped_flag boolean;
  cleaned_phone text;
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');

  SELECT id INTO customer_id_var FROM public.customers WHERE email = NEW.email;

  unverified_address_flag := COALESCE((NEW.addons->>'unverifiedAddress')::boolean, FALSE);
  verification_skipped_flag := COALESCE(
    (NEW.addons->>'verificationSkipped')::boolean,
    (NEW.addons->>'wasVerificationSkipped')::boolean,
    FALSE
  );
  address_verification_skipped_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);

  NEW.pending_address_verification := COALESCE((NEW.addons->>'pending_address_verification')::boolean, FALSE);
  IF NEW.pending_address_verification THEN
     NEW.unverified_address := NEW.addons->>'unverified_address';
     NEW.pending_verification_reason := NEW.addons->>'pending_verification_reason';
     NEW.pending_verification_date := now();
  END IF;

  IF customer_id_var IS NOT NULL THEN
    UPDATE public.customers
    SET
      name = COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name, customers.name),
      first_name = COALESCE(NEW.first_name, customers.first_name),
      last_name = COALESCE(NEW.last_name, customers.last_name),
      phone = COALESCE(cleaned_phone, customers.phone),
      street = COALESCE(NEW.street, customers.street),
      city = COALESCE(NEW.city, customers.city),
      state = COALESCE(NEW.state, customers.state),
      zip = COALESCE(NEW.zip, customers.zip),
      unverified_address = customers.unverified_address OR unverified_address_flag,
      has_incomplete_verification = customers.has_incomplete_verification OR verification_skipped_flag
    WHERE id = customer_id_var;
  ELSE
    INSERT INTO public.customers (
      name, first_name, last_name, email, phone, street, city, state, zip,
      unverified_address, has_incomplete_verification, segment
    )
    VALUES (
      COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name),
      NEW.first_name, NEW.last_name, NEW.email, cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip,
      unverified_address_flag, verification_skipped_flag, 'feedback_lead'
    )
    RETURNING id INTO customer_id_var;
  END IF;

  NEW.customer_id := customer_id_var;
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  NEW.name := COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name);
  NEW.status := 'pending_payment';

  RETURN NEW;
END;
$$;

-- Promote to booked when a booking leaves pending_payment for a real status
CREATE OR REPLACE FUNCTION public.promote_customer_segment_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND lower(COALESCE(NEW.status, '')) NOT IN ('pending_payment', 'cancelled', 'canceled')
  THEN
    UPDATE public.customers
    SET segment = 'booked'
    WHERE id = NEW.customer_id
      AND segment IS DISTINCT FROM 'booked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_customer_segment_on_booking ON public.bookings;
CREATE TRIGGER trg_promote_customer_segment_on_booking
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_customer_segment_on_booking();

-- ---------------------------------------------------------------------------
-- Feedback questions / tokens / responses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_questions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  prompt text NOT NULL,
  field_key text NOT NULL UNIQUE,
  input_type text NOT NULL DEFAULT 'single_choice'
    CHECK (input_type = ANY (ARRAY['single_choice'::text, 'multi_choice'::text, 'short_text'::text])),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_required boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.feedback_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  token text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  email_sent_at timestamptz,
  email_message_id text
);

CREATE INDEX IF NOT EXISTS idx_feedback_tokens_customer ON public.feedback_tokens (customer_id);
CREATE INDEX IF NOT EXISTS idx_feedback_tokens_booking ON public.feedback_tokens (booking_id);

CREATE TABLE IF NOT EXISTS public.feedback_responses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  token_id bigint REFERENCES public.feedback_tokens(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'early_leave'
);

CREATE INDEX IF NOT EXISTS idx_feedback_responses_customer ON public.feedback_responses (customer_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_created ON public.feedback_responses (created_at DESC);

ALTER TABLE public.feedback_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage feedback_questions" ON public.feedback_questions;
CREATE POLICY "Admins manage feedback_questions"
  ON public.feedback_questions
  FOR ALL
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admins read feedback_tokens" ON public.feedback_tokens;
CREATE POLICY "Admins read feedback_tokens"
  ON public.feedback_tokens
  FOR SELECT
  USING ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Service role manage feedback_tokens" ON public.feedback_tokens;
CREATE POLICY "Service role manage feedback_tokens"
  ON public.feedback_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins read feedback_responses" ON public.feedback_responses;
CREATE POLICY "Admins read feedback_responses"
  ON public.feedback_responses
  FOR SELECT
  USING ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage feedback_responses" ON public.feedback_responses;
CREATE POLICY "Admins manage feedback_responses"
  ON public.feedback_responses
  FOR ALL
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

-- Seed default questions (idempotent by field_key)
INSERT INTO public.feedback_questions (prompt, field_key, input_type, options, sort_order, is_active, is_required)
VALUES
  (
    'Why did you leave today?',
    'why_left',
    'single_choice',
    '["Just browsing","Price felt high","Could not find the right dates","Website was confusing","Changed my mind","Other"]'::jsonb,
    10,
    true,
    true
  ),
  (
    'What almost stopped you from finishing?',
    'almost_stopped',
    'single_choice',
    '["Pricing","Scheduling / availability","Payment concerns","Missing information","Technical issue","Nothing specific","Other"]'::jsonb,
    20,
    true,
    true
  ),
  (
    'How did our pricing feel?',
    'pricing',
    'single_choice',
    '["Great value","Fair","A bit high","Too expensive","Not sure"]'::jsonb,
    30,
    true,
    false
  ),
  (
    'How was scheduling / availability?',
    'scheduling',
    'single_choice',
    '["Easy to find dates","Limited options","Dates did not work","Confusing","Not sure"]'::jsonb,
    40,
    true,
    false
  ),
  (
    'How easy was the website to use?',
    'website_ease',
    'single_choice',
    '["Very easy","Mostly easy","Okay","Difficult","Very difficult"]'::jsonb,
    50,
    true,
    false
  ),
  (
    'Did our services fit the job you needed done?',
    'service_fit',
    'single_choice',
    '["Perfect fit","Mostly fit","Somewhat","Not really","Not sure"]'::jsonb,
    60,
    true,
    false
  ),
  (
    'Anything else we should know?',
    'anything_else',
    'short_text',
    '[]'::jsonb,
    70,
    true,
    false
  )
ON CONFLICT (field_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RPCs for leave-early + public feedback form
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_customer_feedback_lead(p_customer_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- Do not demote customers who already have a real booking
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.customer_id = p_customer_id
      AND lower(COALESCE(b.status, '')) NOT IN ('pending_payment', 'cancelled', 'canceled')
  ) THEN
    UPDATE public.customers SET segment = 'booked' WHERE id = p_customer_id;
    RETURN;
  END IF;

  UPDATE public.customers
  SET segment = 'feedback_lead'
  WHERE id = p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_early_leave_feedback_token(p_booking_id bigint)
RETURNS TABLE (
  token text,
  customer_id bigint,
  email text,
  first_name text,
  site_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  b record;
  v_token text;
  v_expires timestamptz := timezone('utc', now()) + interval '30 days';
BEGIN
  SELECT
    bk.id,
    bk.customer_id,
    bk.email,
    bk.first_name,
    bk.name,
    bk.status
  INTO b
  FROM public.bookings bk
  WHERE bk.id = p_booking_id;

  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF b.customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking has no customer';
  END IF;

  IF b.email IS NULL OR length(trim(b.email)) = 0 THEN
    RAISE EXCEPTION 'Booking has no email';
  END IF;

  PERFORM public.mark_customer_feedback_lead(b.customer_id);

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.feedback_tokens (token, customer_id, booking_id, expires_at)
  VALUES (v_token, b.customer_id, b.id, v_expires);

  token := v_token;
  customer_id := b.customer_id;
  email := b.email;
  first_name := COALESCE(NULLIF(trim(b.first_name), ''), split_part(COALESCE(b.name, 'there'), ' ', 1), 'there');
  site_path := '/how-can-we-do-better?token=' || v_token;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_feedback_form_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  questions jsonb;
BEGIN
  SELECT *
  INTO t
  FROM public.feedback_tokens
  WHERE token = p_token;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link was already used');
  END IF;

  IF t.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link has expired');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'prompt', q.prompt,
      'field_key', q.field_key,
      'input_type', q.input_type,
      'options', q.options,
      'is_required', q.is_required,
      'sort_order', q.sort_order
    )
    ORDER BY q.sort_order, q.id
  ), '[]'::jsonb)
  INTO questions
  FROM public.feedback_questions q
  WHERE q.is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
        'name', c.name,
        'email', c.email
      )
      FROM public.customers c
      WHERE c.id = t.customer_id
    ),
    'booking_id', t.booking_id,
    'questions', questions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_feedback_response(
  p_token text,
  p_answers jsonb,
  p_comments text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  response_id bigint;
  chat_body text;
  q record;
  answer_val text;
  comments_clean text := trim(COALESCE(p_comments, ''));
BEGIN
  IF comments_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please share a comment so we can improve');
  END IF;

  SELECT *
  INTO t
  FROM public.feedback_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link was already used');
  END IF;

  IF t.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback link has expired');
  END IF;

  INSERT INTO public.feedback_responses (
    customer_id, booking_id, token_id, answers, comments, source
  )
  VALUES (
    t.customer_id,
    t.booking_id,
    t.id,
    COALESCE(p_answers, '{}'::jsonb),
    comments_clean,
    'early_leave'
  )
  RETURNING id INTO response_id;

  UPDATE public.feedback_tokens
  SET used_at = timezone('utc', now())
  WHERE id = t.id;

  PERFORM public.mark_customer_feedback_lead(t.customer_id);

  chat_body := E'How can we do better — customer feedback submitted:\n\n';
  FOR q IN
    SELECT prompt, field_key
    FROM public.feedback_questions
    WHERE is_active = true
    ORDER BY sort_order, id
  LOOP
    answer_val := COALESCE(p_answers->>q.field_key, '');
    IF answer_val <> '' THEN
      chat_body := chat_body || '• ' || q.prompt || E'\n  → ' || answer_val || E'\n\n';
    END IF;
  END LOOP;
  chat_body := chat_body || 'Comments:\n' || comments_clean;

  INSERT INTO public.chat_messages (
    conversation_id,
    customer_id,
    booking_id,
    sender_type,
    message_content,
    is_read,
    message_severity,
    message_context
  )
  VALUES (
    'cust_' || t.customer_id::text,
    t.customer_id,
    t.booking_id,
    'admin',
    chat_body,
    false,
    'info',
    jsonb_build_object(
      'type', 'how_can_we_do_better',
      'feedback_response_id', response_id
    )
  );

  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = t.customer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'response_id', response_id,
    'customer_id', t.customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feedback_form_by_token(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_feedback_response(text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_early_leave_feedback_token(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_customer_feedback_lead(bigint) TO service_role;
