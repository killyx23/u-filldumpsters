-- Survey follow-up: used tokens return mode "done" (thank-you + Contact), not public chat.
-- Contact form notes mention related How can we do better survey when present.

CREATE OR REPLACE FUNCTION public.get_feedback_form_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  questions jsonb;
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT *
  INTO t
  FROM public.feedback_tokens
  WHERE token = p_token;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  -- Already submitted: thank-you / Contact follow-up (no public chat).
  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'done',
      'booking_id', t.booking_id,
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id,
          'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
          'name', c.name,
          'email', c.email
        )
        FROM public.customers c
        WHERE c.id = t.customer_id
      )
    );
  END IF;

  IF t.expires_at < v_now THEN
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
    'mode', 'form',
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

-- Keep submit behavior; return mode done for the thank-you UI.
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
  v_chat_expires timestamptz;
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

  v_chat_expires := timezone('utc', now()) + interval '30 days';

  UPDATE public.feedback_tokens
  SET
    used_at = timezone('utc', now()),
    chat_expires_at = v_chat_expires
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

  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = t.customer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'done',
    'response_id', response_id,
    'customer_id', t.customer_id
  );
END;
$$;

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
  survey_at timestamptz;
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

  SELECT fr.created_at
  INTO survey_at
  FROM public.feedback_responses fr
  WHERE fr.customer_id = customer_id_var
  ORDER BY fr.created_at DESC
  LIMIT 1;

  IF survey_at IS NOT NULL THEN
    note_body := note_body || E'\n\nRelated: How can we do better survey on '
      || to_char(survey_at AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  END IF;

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

  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = customer_id_var;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feedback_form_by_token(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_feedback_response(text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_contact_form(text, text, text) TO anon, authenticated, service_role;
