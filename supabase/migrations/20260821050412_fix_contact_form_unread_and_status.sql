-- Contact Us → How can we do better (when unpaid) + real unread flags
-- Also: leave-early survey inserts a bookkeeping customer_note for Status/clear path

-- ---------------------------------------------------------------------------
-- handle_contact_form: case-insensitive match, segment, unread note
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_contact_form(
  contact_name text,
  contact_email text,
  contact_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  customer_id_var bigint;
  email_clean text := lower(trim(COALESCE(contact_email, '')));
  name_clean text := trim(COALESCE(contact_name, ''));
  message_clean text := trim(COALESCE(contact_message, ''));
  has_paid_booking boolean := false;
  note_body text;
BEGIN
  IF email_clean = '' OR message_clean = '' THEN
    RAISE EXCEPTION 'Email and message are required';
  END IF;

  SELECT c.id
    INTO customer_id_var
  FROM public.customers c
  WHERE lower(trim(c.email)) = email_clean
  ORDER BY c.id
  LIMIT 1;

  IF customer_id_var IS NULL THEN
    INSERT INTO public.customers (name, email, segment)
    VALUES (
      COALESCE(NULLIF(name_clean, ''), email_clean),
      email_clean,
      'feedback_lead'
    )
    RETURNING id INTO customer_id_var;
  ELSE
    -- Refresh name if blank
    UPDATE public.customers
    SET
      name = CASE
        WHEN COALESCE(trim(name), '') = '' AND name_clean <> '' THEN name_clean
        ELSE name
      END,
      email = CASE
        WHEN lower(trim(email)) <> email_clean THEN email_clean
        ELSE email
      END
    WHERE id = customer_id_var;

    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.customer_id = customer_id_var
        AND b.status IS NOT NULL
        AND lower(COALESCE(b.status, '')) NOT IN (
          'pending_payment',
          'cancelled',
          'canceled'
        )
    ) INTO has_paid_booking;

    -- Contact-only / unpaid leads belong under How can we do better
    IF NOT has_paid_booking THEN
      UPDATE public.customers
      SET segment = 'feedback_lead'
      WHERE id = customer_id_var
        AND segment IS DISTINCT FROM 'feedback_lead';
    END IF;
  END IF;

  note_body := format(
    E'Contact form inquiry from %s <%s>:\n\n%s',
    COALESCE(NULLIF(name_clean, ''), 'Unknown'),
    email_clean,
    message_clean
  );

  INSERT INTO public.customer_notes (
    customer_id,
    source,
    content,
    author_type,
    is_read
  )
  VALUES (
    customer_id_var,
    'Contact Form Inquiry',
    note_body,
    'customer',
    false
  );

  -- Belt-and-suspenders with handle_new_note trigger
  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = customer_id_var;
END;
$$;

ALTER FUNCTION public.handle_contact_form(text, text, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.handle_contact_form(text, text, text) TO anon;
GRANT ALL ON FUNCTION public.handle_contact_form(text, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.handle_contact_form(text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- submit_feedback_response: keep chat card + insert unread bookkeeping note
-- (source 'How Can We Do Better' is NOT shown in Chat note feed — avoids duplicate)
-- ---------------------------------------------------------------------------
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
  answers_ctx jsonb := '[]'::jsonb;
  message_ctx jsonb;
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
      answers_ctx := answers_ctx || jsonb_build_array(
        jsonb_build_object(
          'prompt', q.prompt,
          'field_key', q.field_key,
          'answer', answer_val
        )
      );
    END IF;
  END LOOP;
  chat_body := chat_body || E'Comments:\n' || comments_clean;

  message_ctx := jsonb_build_object(
    'type', 'how_can_we_do_better',
    'feedback_response_id', response_id,
    'answers', answers_ctx,
    'comments', comments_clean,
    'booking_id', t.booking_id
  );

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
    message_ctx
  );

  -- Bookkeeping note so Status/unread triggers share one model with Contact Form
  INSERT INTO public.customer_notes (
    customer_id,
    booking_id,
    source,
    content,
    author_type,
    is_read
  )
  VALUES (
    t.customer_id,
    t.booking_id,
    'How Can We Do Better',
    left(
      format(
        'How can we do better survey submitted (response #%s). Comments: %s',
        response_id,
        comments_clean
      ),
      2000
    ),
    'customer',
    false
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

GRANT EXECUTE ON FUNCTION public.submit_feedback_response(text, jsonb, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: contact-only leads → feedback_lead; fix note author_type / unread
-- ---------------------------------------------------------------------------

-- Fix Contact Form notes missing author_type
UPDATE public.customer_notes
SET author_type = 'customer'
WHERE source = 'Contact Form Inquiry'
  AND (author_type IS NULL OR author_type = '');

-- Contact-only customers (no paid booking) → How can we do better tab
UPDATE public.customers c
SET segment = 'feedback_lead'
WHERE EXISTS (
  SELECT 1
  FROM public.customer_notes n
  WHERE n.customer_id = c.id
    AND n.source = 'Contact Form Inquiry'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.bookings b
  WHERE b.customer_id = c.id
    AND b.status IS NOT NULL
    AND lower(COALESCE(b.status, '')) NOT IN (
      'pending_payment',
      'cancelled',
      'canceled'
    )
);

-- Recompute has_unread_notes from unread customer-authored notes
UPDATE public.customers c
SET has_unread_notes = EXISTS (
  SELECT 1
  FROM public.customer_notes n
  WHERE n.customer_id = c.id
    AND n.author_type = 'customer'
    AND COALESCE(n.is_read, false) = false
);

-- For existing survey responses without a bookkeeping note, add one if still unread-ish
INSERT INTO public.customer_notes (
  customer_id,
  booking_id,
  source,
  content,
  author_type,
  is_read
)
SELECT
  fr.customer_id,
  fr.booking_id,
  'How Can We Do Better',
  left(
    format(
      'How can we do better survey submitted (response #%s). Comments: %s',
      fr.id,
      COALESCE(fr.comments, '')
    ),
    2000
  ),
  'customer',
  -- If customer already has no unread flag and no unread customer notes, treat as already seen
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.customers cu
      WHERE cu.id = fr.customer_id AND COALESCE(cu.has_unread_notes, false) = true
    ) THEN false
    ELSE true
  END
FROM public.feedback_responses fr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.customer_notes n
  WHERE n.customer_id = fr.customer_id
    AND n.source = 'How Can We Do Better'
    AND n.content LIKE '%response #' || fr.id::text || '%'
);

-- Final unread recompute after survey note backfill
UPDATE public.customers c
SET has_unread_notes = EXISTS (
  SELECT 1
  FROM public.customer_notes n
  WHERE n.customer_id = c.id
    AND n.author_type = 'customer'
    AND COALESCE(n.is_read, false) = false
);
