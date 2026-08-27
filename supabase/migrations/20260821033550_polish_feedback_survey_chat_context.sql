-- Enrich How can we do better chat messages with structured context
-- and fix literal '\n' in Comments line (must use E'...' escape strings).

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
  -- Must use E'...' so \n becomes a real newline (plain 'Comments:\n' stored a literal backslash-n)
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
    'response_id', response_id,
    'customer_id', t.customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_feedback_response(text, jsonb, text)
  TO anon, authenticated, service_role;

-- Backfill structured context onto existing feedback chat messages
UPDATE public.chat_messages cm
SET message_context = COALESCE(cm.message_context, '{}'::jsonb) || jsonb_build_object(
  'type', 'how_can_we_do_better',
  'feedback_response_id', fr.id,
  'comments', fr.comments,
  'answers', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'prompt', fq.prompt,
        'field_key', fq.field_key,
        'answer', fr.answers->>fq.field_key
      )
      ORDER BY fq.sort_order, fq.id
    )
    FROM public.feedback_questions fq
    WHERE fq.is_active
      AND COALESCE(fr.answers->>fq.field_key, '') <> ''
  ), '[]'::jsonb),
  'booking_id', fr.booking_id
)
FROM public.feedback_responses fr
WHERE (
    cm.message_context->>'type' = 'how_can_we_do_better'
    OR cm.message_content ILIKE 'How can we do better%'
  )
  AND (
    (NULLIF(cm.message_context->>'feedback_response_id', ''))::bigint = fr.id
    OR (cm.customer_id = fr.customer_id AND cm.booking_id IS NOT DISTINCT FROM fr.booking_id)
  )
  AND (
    cm.message_context->'answers' IS NULL
    OR jsonb_typeof(cm.message_context->'answers') = 'null'
    OR jsonb_typeof(cm.message_context->'answers') <> 'array'
  );
