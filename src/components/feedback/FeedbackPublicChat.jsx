import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { FeedbackSurveyMessageContent } from '@/components/chat/FeedbackSurveyMessageContent';
import { isHowCanWeDoBetterMessage } from '@/utils/feedbackSurveyMessage';
import { Bookmark, Loader2, MessageCircle, Phone, Send } from 'lucide-react';

function formatMessageTime(value) {
  if (!value) return '';
  try {
    return format(new Date(value), 'MMM d, h:mm a');
  } catch {
    return '';
  }
}

/** Mask email for display: rebekah@example.com → r***@example.com */
export function maskEmail(email) {
  const raw = String(email || '').trim();
  if (!raw || !raw.includes('@')) return null;
  const [local, domain] = raw.split('@');
  if (!domain) return null;
  const first = local.charAt(0) || '*';
  return `${first}***@${domain}`;
}

/**
 * Token-gated public reply thread for How can we do better (no portal login).
 */
export function FeedbackPublicChat({
  token,
  firstName = 'there',
  customerEmail = null,
  chatExpiresAt = null,
  intro = true,
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [resolvedEmail, setResolvedEmail] = useState(customerEmail);
  const bottomRef = useRef(null);
  const listRef = useRef(null);

  const maskedEmail = useMemo(
    () => maskEmail(resolvedEmail || customerEmail),
    [resolvedEmail, customerEmail],
  );

  const loadMessages = useCallback(async ({ silent = false } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);

    const { data, error: rpcError } = await supabase.rpc('get_feedback_chat_messages', {
      p_token: token,
    });

    if (rpcError) {
      setError(rpcError.message);
      if (!silent) setLoading(false);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Unable to load this conversation.');
      if (!silent) setLoading(false);
      return;
    }

    setMessages(Array.isArray(data.messages) ? data.messages : []);
    if (data.customer?.email) {
      setResolvedEmail(data.customer.email);
    }
    setError('');
    if (!silent) setLoading(false);
  }, [token]);

  useEffect(() => {
    loadMessages();
    const id = setInterval(() => loadMessages({ silent: true }), 8000);
    return () => clearInterval(id);
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    const { data, error: rpcError } = await supabase.rpc('post_feedback_chat_message', {
      p_token: token,
      p_body: body,
    });
    setSending(false);

    if (rpcError || !data?.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not send',
        description: rpcError?.message || data?.error || 'Please try again.',
      });
      return;
    }

    setDraft('');
    await loadMessages({ silent: true });
  };

  const expiresLabel = chatExpiresAt
    ? (() => {
        try {
          return format(new Date(chatExpiresAt), 'MMM d, yyyy');
        } catch {
          return null;
        }
      })()
    : null;

  if (error) {
    return (
      <div className="space-y-4 rounded-xl border border-orange-400/40 bg-orange-950/40 p-6 text-center">
        <p className="text-orange-100">{error}</p>
        <Button asChild className="bg-amber-400 text-slate-900 hover:bg-amber-300">
          <Link to="/contact">Contact us instead</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {intro ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/15">
            <MessageCircle className="h-7 w-7 text-amber-300" />
          </div>
          <p className="text-lg font-semibold text-white">Thanks, {firstName}.</p>
          <div className="mx-auto max-w-md space-y-3 rounded-xl border border-white/10 bg-slate-900/50 px-4 py-4 text-left text-sm leading-relaxed text-blue-100">
            <p>
              <span className="font-semibold text-white">Your answers are saved.</span>{' '}
              Our team can reply in this conversation below.
            </p>
            <p className="flex gap-2">
              <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <span>
                <span className="font-semibold text-white">How to continue:</span> keep this page
                open, or bookmark this link. No account or customer number needed — this URL is
                your conversation.
              </span>
            </p>
            {maskedEmail ? (
              <p>
                <span className="font-semibold text-white">Email notices:</span> when our team
                replies, we send a short notice to{' '}
                <span className="font-semibold text-amber-200">{maskedEmail}</span> with a link
                back here. Replies themselves appear in this chat — not in a separate inbox.
              </p>
            ) : null}
          </div>
          {expiresLabel ? (
            <p className="text-xs text-blue-200/80">This conversation link works until {expiresLabel}.</p>
          ) : null}
        </div>
      ) : null}

      <div
        ref={listRef}
        className="max-h-[420px] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/50 p-4"
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-blue-200/80">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const isSurvey = isHowCanWeDoBetterMessage(message);
            const fromCustomer = message.sender_type === 'customer';
            const fromAdmin = message.sender_type === 'admin' && !isSurvey;

            return (
              <div
                key={message.id}
                className={`flex ${fromCustomer ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3.5 py-3 ${
                    isSurvey
                      ? 'w-full border border-amber-400/25 bg-amber-400/[0.08]'
                      : fromCustomer
                        ? 'border border-amber-400/40 bg-amber-400/20 text-amber-50'
                        : 'border border-white/15 bg-white/[0.06] text-blue-50'
                  }`}
                >
                  {isSurvey ? (
                    <FeedbackSurveyMessageContent message={message} />
                  ) : (
                    <>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-blue-200/70">
                        {fromAdmin ? 'U-Fill team' : 'You'}
                        {message.created_at ? (
                          <span className="ml-2 font-medium normal-case tracking-normal text-blue-200/50">
                            {formatMessageTime(message.created_at)}
                          </span>
                        ) : null}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">
                        {message.message_content}
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Write a message to our team…"
          className="border-white/20 bg-slate-950/70 text-white placeholder:text-gray-400"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="submit"
            disabled={sending || !draft.trim()}
            className="bg-amber-400 font-bold text-slate-900 hover:bg-amber-300"
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send message
              </>
            )}
          </Button>
          <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
            <Link to="/contact">
              <Phone className="mr-2 h-4 w-4" />
              Contact page
            </Link>
          </Button>
        </div>
      </form>

      <div className="text-center">
        <Button asChild variant="ghost" className="text-blue-200 hover:bg-white/5 hover:text-white">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

export default FeedbackPublicChat;
