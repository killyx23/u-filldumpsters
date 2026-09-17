-- Include customer email on feedback chat RPC so the public UI can show
-- which address will receive reply notices (masked client-side).

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
        'name', c.name,
        'email', c.email
      )
      FROM public.customers c
      WHERE c.id = (gate->>'customer_id')::bigint
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feedback_chat_messages(text) TO anon, authenticated, service_role;
