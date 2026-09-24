-- Token-gated public reply chat for How can we do better survey.
-- After submit, the same feedback token stays valid for chat until chat_expires_at.

ALTER TABLE public.feedback_tokens
  ADD COLUMN IF NOT EXISTS chat_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS chat_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_chat_reply_email_at timestamptz;

COMMENT ON COLUMN public.feedback_tokens.chat_expires_at IS
  'When set, the survey token may open the public reply thread until this time.';
COMMENT ON COLUMN public.feedback_tokens.chat_closed_at IS
  'When set, the public reply thread is closed even if chat_expires_at is in the future.';
COMMENT ON COLUMN public.feedback_tokens.last_chat_reply_email_at IS
  'Debounce timestamp for admin-reply notification emails.';

-- Backfill: used tokens get a 30-day chat window from submit time.
UPDATE public.feedback_tokens
SET chat_expires_at = used_at + interval '30 days'
WHERE used_at IS NOT NULL
  AND chat_expires_at IS NULL;

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

  -- Already submitted: open chat mode when the reply window is still active.
  IF t.used_at IS NOT NULL THEN
    IF t.chat_closed_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This feedback conversation is closed. You can still reach us on the Contact page.',
        'mode', 'closed'
      );
    END IF;

    IF t.chat_expires_at IS NULL OR t.chat_expires_at < v_now THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This feedback conversation link has expired. You can still reach us on the Contact page.',
        'mode', 'expired'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'chat',
      'chat_expires_at', t.chat_expires_at,
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
    'mode', 'chat',
    'response_id', response_id,
    'customer_id', t.customer_id,
    'chat_expires_at', v_chat_expires
  );
END;
$$;

-- Shared gate for public chat RPCs.
CREATE OR REPLACE FUNCTION public._feedback_chat_token_or_error(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT *
  INTO t
  FROM public.feedback_tokens
  WHERE token = p_token;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid feedback link');
  END IF;

  IF t.used_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Submit the feedback form before chatting');
  END IF;

  IF t.chat_closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback conversation is closed', 'mode', 'closed');
  END IF;

  IF t.chat_expires_at IS NULL OR t.chat_expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This feedback conversation link has expired', 'mode', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'token_id', t.id,
    'customer_id', t.customer_id,
    'booking_id', t.booking_id,
    'used_at', t.used_at,
    'chat_expires_at', t.chat_expires_at,
    'conversation_id', 'cust_' || t.customer_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_feedback_chat_messages(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  gate jsonb;
  msgs jsonb;
BEGIN
  gate := public._feedback_chat_token_or_error(p_token);
  IF COALESCE((gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN gate;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'sender_type', m.sender_type,
      'message_content', m.message_content,
      'message_severity', m.message_severity,
      'message_context', m.message_context,
      'created_at', m.created_at
    )
    ORDER BY m.created_at ASC, m.id ASC
  ), '[]'::jsonb)
  INTO msgs
  FROM public.chat_messages m
  WHERE m.conversation_id = gate->>'conversation_id'
    AND m.created_at >= (gate->>'used_at')::timestamptz
    AND (
      COALESCE(m.message_context->>'type', '') = 'how_can_we_do_better'
      OR COALESCE(m.message_severity, '') IS DISTINCT FROM 'info'
    );

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'chat',
    'chat_expires_at', gate->>'chat_expires_at',
    'messages', msgs,
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'first_name', COALESCE(NULLIF(trim(c.first_name), ''), split_part(c.name, ' ', 1)),
        'name', c.name
      )
      FROM public.customers c
      WHERE c.id = (gate->>'customer_id')::bigint
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_feedback_chat_message(p_token text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  gate jsonb;
  body_clean text := trim(COALESCE(p_body, ''));
  recent_count int;
  new_id uuid;
BEGIN
  gate := public._feedback_chat_token_or_error(p_token);
  IF COALESCE((gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN gate;
  END IF;

  IF body_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message cannot be empty');
  END IF;

  IF char_length(body_clean) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message is too long (max 4000 characters)');
  END IF;

  SELECT COUNT(*)::int
  INTO recent_count
  FROM public.chat_messages m
  WHERE m.conversation_id = gate->>'conversation_id'
    AND m.sender_type = 'customer'
    AND m.created_at >= timezone('utc', now()) - interval '1 hour';

  IF recent_count >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Too many messages. Please wait a bit and try again.');
  END IF;

  INSERT INTO public.chat_messages (
    conversation_id,
    customer_id,
    booking_id,
    sender_type,
    message_content,
    is_read,
    message_context
  )
  VALUES (
    gate->>'conversation_id',
    (gate->>'customer_id')::bigint,
    NULLIF(gate->>'booking_id', '')::bigint,
    'customer',
    body_clean,
    false,
    jsonb_build_object(
      'type', 'feedback_public_chat',
      'feedback_token_id', (gate->>'token_id')::bigint
    )
  )
  RETURNING id INTO new_id;

  UPDATE public.customers
  SET has_unread_notes = true
  WHERE id = (gate->>'customer_id')::bigint;

  RETURN jsonb_build_object(
    'ok', true,
    'message_id', new_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feedback_form_by_token(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_feedback_response(text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_feedback_chat_messages(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_feedback_chat_message(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._feedback_chat_token_or_error(text) FROM PUBLIC;

-- Notify lead by email when staff reply in an active feedback chat thread.
CREATE OR REPLACE FUNCTION public.notify_feedback_chat_admin_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$
DECLARE
  t record;
  v_url text;
  v_key text;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;

  -- Skip the initial survey card and other system info noise.
  IF COALESCE(NEW.message_context->>'type', '') = 'how_can_we_do_better' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.message_severity, '') = 'info'
     AND COALESCE(NEW.message_context->>'type', '') <> 'feedback_public_chat' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO t
  FROM public.feedback_tokens
  WHERE customer_id = NEW.customer_id
    AND used_at IS NOT NULL
    AND chat_closed_at IS NULL
    AND chat_expires_at IS NOT NULL
    AND chat_expires_at > timezone('utc', now())
  ORDER BY used_at DESC
  LIMIT 1;

  IF t.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Debounce: at most one email per 2 minutes per token.
  IF t.last_chat_reply_email_at IS NOT NULL
     AND t.last_chat_reply_email_at > timezone('utc', now()) - interval '2 minutes' THEN
    RETURN NEW;
  END IF;

  UPDATE public.feedback_tokens
  SET last_chat_reply_email_at = timezone('utc', now())
  WHERE id = t.id;

  BEGIN
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;

    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE WARNING '[notify_feedback_chat_admin_reply] missing vault secrets supabase_url/service_role_key';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/notify-feedback-chat-reply',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'token_id', t.id,
        'customer_id', t.customer_id,
        'message_id', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_feedback_chat_admin_reply] http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_feedback_chat_admin_reply ON public.chat_messages;
CREATE TRIGGER trg_notify_feedback_chat_admin_reply
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_feedback_chat_admin_reply();
