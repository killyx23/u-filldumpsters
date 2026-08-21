import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import BackButton from '@/components/BackButton';
import { Check, Loader2, MessageCircle, Phone, StickyNote } from 'lucide-react';

export const HowCanWeDoBetterPage = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [answers, setAnswers] = useState({});
  const [comments, setComments] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        setError('This feedback link is missing or invalid.');
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error: rpcError } = await supabase.rpc('get_feedback_form_by_token', {
        p_token: token,
      });

      if (cancelled) return;

      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }

      if (!data?.ok) {
        setError(data?.error || 'Unable to load this feedback form.');
        setLoading(false);
        return;
      }

      setForm(data);
      setError('');
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const questions = useMemo(() => form?.questions || [], [form]);
  const firstName = form?.customer?.first_name || 'there';

  const setAnswer = (fieldKey, value) => {
    setAnswers((prev) => ({ ...prev, [fieldKey]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    for (const q of questions) {
      if (!q.is_required) continue;
      const value = answers[q.field_key];
      if (value == null || String(value).trim() === '') {
        toast({
          variant: 'destructive',
          title: 'Almost there',
          description: `Please answer: ${q.prompt}`,
        });
        return;
      }
    }

    if (!comments.trim()) {
      toast({
        variant: 'destructive',
        title: 'Comments required',
        description: 'Please share a note so we know how we can improve.',
      });
      return;
    }

    setSubmitting(true);
    const { data, error: rpcError } = await supabase.rpc('submit_feedback_response', {
      p_token: token,
      p_answers: answers,
      p_comments: comments.trim(),
    });
    setSubmitting(false);

    if (rpcError || !data?.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not submit feedback',
        description: rpcError?.message || data?.error || 'Please try again.',
      });
      return;
    }

    setSubmitted(true);
    toast({
      title: 'Thank you',
      description: 'Your feedback was saved. We appreciate you taking the time.',
    });
  };

  return (
    <>
      <Helmet>
        <title>How Can We Do Better - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Tell U-Fill Dumpsters how we can serve you better. Share feedback after leaving checkout."
        />
      </Helmet>

      <div className="relative min-h-[70vh]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(251,191,36,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(30,58,138,0.35),_transparent_60%)]"
        />
        <BackButton className="absolute top-4 left-4 z-20" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="container relative z-10 mx-auto max-w-2xl py-16 px-4"
        >
          <div className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 shadow-2xl backdrop-blur-md">
            <div className="border-b border-amber-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 px-8 py-10 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
                U-Fill Dumpsters
              </p>
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-white md:text-4xl">
                How can we do better?
              </h1>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-blue-100/90 md:text-base">
                We love hearing your opinions. Tell us what would help you get the job done —
                or why you decided not to book with us today.
              </p>
            </div>

            <div className="p-6 md:p-8">
              {loading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-10 w-10 animate-spin text-amber-300" />
                </div>
              ) : error ? (
                <div className="space-y-4 rounded-xl border border-orange-400/40 bg-orange-950/40 p-6 text-center">
                  <p className="text-orange-100">{error}</p>
                  <Button asChild className="bg-amber-400 text-slate-900 hover:bg-amber-300">
                    <Link to="/contact">Contact us instead</Link>
                  </Button>
                </div>
              ) : submitted ? (
                <div className="space-y-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/15">
                    <MessageCircle className="h-7 w-7 text-amber-300" />
                  </div>
                  <p className="text-lg text-white">
                    Thanks, {firstName}. Your answers are in our system and our team can follow up
                    from your customer chat.
                  </p>
                  <div className="rounded-xl border border-blue-400/30 bg-blue-950/40 p-5">
                    <p className="mb-3 text-blue-100">
                      Want a phone call back on a timeline that works for you?
                    </p>
                    <Button asChild className="bg-amber-400 text-slate-900 hover:bg-amber-300">
                      <Link to="/contact">
                        <Phone className="mr-2 h-4 w-4" />
                        Go to Contact page
                      </Link>
                    </Button>
                  </div>
                  <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                    <Link to="/">Back to home</Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <p className="text-sm text-blue-200">
                    Hi {firstName} — a few quick questions. Your answers help us improve.
                  </p>

                  {questions.map((q, index) => (
                    <section
                      key={q.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5"
                    >
                      <div className="mb-3 flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-[11px] font-bold text-amber-200">
                          {index + 1}
                        </span>
                        <Label className="text-base font-semibold leading-snug text-white">
                          {q.prompt}
                          {q.is_required ? (
                            <span className="ml-1 text-amber-300" aria-hidden>
                              *
                            </span>
                          ) : null}
                        </Label>
                      </div>

                      {q.input_type === 'short_text' ? (
                        <Input
                          value={answers[q.field_key] || ''}
                          onChange={(e) => setAnswer(q.field_key, e.target.value)}
                          className="border-white/20 bg-slate-950/60 text-white placeholder:text-gray-400"
                          placeholder="Your answer"
                          required={q.is_required}
                        />
                      ) : (
                        <div className="grid gap-2">
                          {(q.options || []).map((opt) => {
                            const selected = answers[q.field_key] === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setAnswer(q.field_key, opt)}
                                className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition ${
                                  selected
                                    ? 'border-amber-400 bg-amber-400/15 text-amber-50 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]'
                                    : 'border-white/12 bg-slate-950/40 text-blue-50 hover:border-white/30 hover:bg-white/[0.04]'
                                }`}
                              >
                                <span className="font-medium leading-snug">{opt}</span>
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                    selected
                                      ? 'border-amber-300 bg-amber-400 text-slate-900'
                                      : 'border-white/25 bg-transparent'
                                  }`}
                                >
                                  {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ))}

                  <section className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 md:p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-amber-300" />
                      <Label htmlFor="comments" className="text-base font-semibold text-white">
                        Your notes *
                      </Label>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-amber-100/80">
                      Tell us what we could offer, change, or clarify to help you get the job done.
                    </p>
                    <Textarea
                      id="comments"
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={5}
                      required
                      placeholder="What could we offer or change to serve you better?"
                      className="border-amber-400/20 bg-slate-950/70 text-white placeholder:text-gray-400"
                    />
                  </section>

                  <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-sm text-blue-100">
                    Prefer talking it through? After you submit, or anytime, use our{' '}
                    <Link to="/contact" className="font-semibold text-amber-300 hover:underline">
                      Contact page
                    </Link>{' '}
                    to request a phone call back.
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-amber-400 text-lg font-bold text-slate-900 hover:bg-amber-300"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Submit feedback'
                    )}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default HowCanWeDoBetterPage;
