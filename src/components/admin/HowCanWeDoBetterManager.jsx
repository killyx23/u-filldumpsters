import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  MessageCircle,
  Filter,
} from 'lucide-react';

const INPUT_TYPES = [
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multi_choice', label: 'Multi choice' },
  { value: 'short_text', label: 'Short text' },
];

function slugifyFieldKey(prompt) {
  return String(prompt || 'question')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || `q_${Date.now()}`;
}

export const HowCanWeDoBetterManager = () => {
  const [tab, setTab] = useState('responses');
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState([]);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [filterKey, setFilterKey] = useState('all');

  const [draft, setDraft] = useState({
    prompt: '',
    field_key: '',
    input_type: 'single_choice',
    optionsText: 'Option A\nOption B\nOption C',
    sort_order: 100,
    is_active: true,
    is_required: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [qRes, rRes] = await Promise.all([
      supabase
        .from('feedback_questions')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('feedback_responses')
        .select('*, customers(id, name, email, phone, first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    if (qRes.error) {
      toast({ title: 'Failed to load questions', description: qRes.error.message, variant: 'destructive' });
    } else {
      setQuestions(qRes.data || []);
    }

    if (rRes.error) {
      toast({ title: 'Failed to load responses', description: rRes.error.message, variant: 'destructive' });
    } else {
      setResponses(rRes.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const questionByKey = useMemo(() => {
    const map = {};
    for (const q of questions) map[q.field_key] = q;
    return map;
  }, [questions]);

  const categoryStats = useMemo(() => {
    const stats = {};
    for (const q of questions.filter((x) => x.is_active)) {
      stats[q.field_key] = { prompt: q.prompt, counts: {} };
    }
    for (const response of responses) {
      const answers = response.answers || {};
      for (const [key, value] of Object.entries(answers)) {
        if (!stats[key]) {
          stats[key] = {
            prompt: questionByKey[key]?.prompt || key,
            counts: {},
          };
        }
        const label = String(value || '').trim() || '(blank)';
        stats[key].counts[label] = (stats[key].counts[label] || 0) + 1;
      }
    }
    return stats;
  }, [questions, responses, questionByKey]);

  const filteredResponses = useMemo(() => {
    if (filterKey === 'all') return responses;
    return responses.filter((r) => {
      const val = r.answers?.[filterKey];
      return val != null && String(val).trim() !== '';
    });
  }, [responses, filterKey]);

  const saveQuestion = async (question, patch) => {
    setSavingQuestion(true);
    const { error } = await supabase
      .from('feedback_questions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', question.id);
    setSavingQuestion(false);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Question updated' });
    load();
  };

  const createQuestion = async (e) => {
    e.preventDefault();
    if (!draft.prompt.trim()) {
      toast({ title: 'Prompt required', variant: 'destructive' });
      return;
    }
    const fieldKey = (draft.field_key.trim() || slugifyFieldKey(draft.prompt)).slice(0, 64);
    const options =
      draft.input_type === 'short_text'
        ? []
        : draft.optionsText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

    setSavingQuestion(true);
    const { error } = await supabase.from('feedback_questions').insert({
      prompt: draft.prompt.trim(),
      field_key: fieldKey,
      input_type: draft.input_type,
      options,
      sort_order: Number(draft.sort_order) || 100,
      is_active: !!draft.is_active,
      is_required: !!draft.is_required,
    });
    setSavingQuestion(false);

    if (error) {
      toast({ title: 'Could not add question', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Question added' });
    setDraft({
      prompt: '',
      field_key: '',
      input_type: 'single_choice',
      optionsText: 'Option A\nOption B\nOption C',
      sort_order: 100,
      is_active: true,
      is_required: false,
    });
    load();
  };

  const deleteQuestion = async (question) => {
    if (!window.confirm(`Deactivate / remove question “${question.prompt}”?`)) return;
    const { error } = await supabase.from('feedback_questions').delete().eq('id', question.id);
    if (error) {
      // Prefer soft-disable if delete blocked
      const { error: updErr } = await supabase
        .from('feedback_questions')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', question.id);
      if (updErr) {
        toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Question deactivated' });
    } else {
      toast({ title: 'Question removed' });
    }
    load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-amber-300" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-white/10 p-6 shadow-xl"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
            <MessageCircle className="h-6 w-6 text-amber-300" />
            How can we do better
          </h2>
          <p className="mt-1 text-sm text-blue-200">
            Feedback from people who left before booking — answers, comments, and categories.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="border-white/30 text-white hover:bg-white/10">
          Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 bg-black/30">
          <TabsTrigger value="responses">Responses ({responses.length})</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
        </TabsList>

        <TabsContent value="responses" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-blue-200" />
            <select
              value={filterKey}
              onChange={(e) => setFilterKey(e.target.value)}
              className="rounded-md border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="all">All responses</option>
              {questions.map((q) => (
                <option key={q.id} value={q.field_key}>
                  Has answer: {q.prompt}
                </option>
              ))}
            </select>
          </div>

          {filteredResponses.length === 0 ? (
            <p className="py-10 text-center text-blue-200">No feedback responses yet.</p>
          ) : (
            <div className="space-y-4">
              {filteredResponses.map((response) => {
                const customer = response.customers;
                return (
                  <div
                    key={response.id}
                    className="rounded-xl border border-white/10 bg-slate-950/50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">
                          {customer?.name || 'Unknown customer'}
                        </p>
                        <p className="text-sm text-blue-200">
                          {customer?.email}
                          {customer?.phone ? ` · ${customer.phone}` : ''}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(response.created_at).toLocaleString()}
                          {response.booking_id ? ` · Booking #${response.booking_id}` : ''}
                        </p>
                      </div>
                      {customer?.id && (
                        <Button asChild size="sm" variant="outline" className="border-white/30 text-white">
                          <Link to={`/admin/customer/${customer.id}?tab=notes`}>Open chat</Link>
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {Object.entries(response.answers || {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-white/5 p-3 text-sm">
                          <p className="mb-1 text-blue-200">
                            {questionByKey[key]?.prompt || key}
                          </p>
                          <p className="font-medium text-white">{String(value)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                        Comments
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-white">{response.comments}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          {Object.keys(categoryStats).length === 0 ? (
            <p className="py-10 text-center text-blue-200">No categorized answers yet.</p>
          ) : (
            Object.entries(categoryStats).map(([key, stat]) => (
              <div key={key} className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                <h3 className="mb-3 font-semibold text-white">{stat.prompt}</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stat.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, count]) => (
                      <span
                        key={label}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-blue-50"
                      >
                        {label}: <strong className="text-amber-300">{count}</strong>
                      </span>
                    ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="questions" className="space-y-6">
          <form
            onSubmit={createQuestion}
            className="space-y-3 rounded-xl border border-dashed border-amber-400/40 bg-amber-400/5 p-4"
          >
            <h3 className="flex items-center gap-2 font-semibold text-amber-200">
              <Plus className="h-4 w-4" /> Add your own question
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label className="text-white">Prompt</Label>
                <Input
                  value={draft.prompt}
                  onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="What should we ask?"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-white">Field key (optional)</Label>
                <Input
                  value={draft.field_key}
                  onChange={(e) => setDraft((d) => ({ ...d, field_key: e.target.value }))}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="auto_from_prompt"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-white">Input type</Label>
                <select
                  value={draft.input_type}
                  onChange={(e) => setDraft((d) => ({ ...d, input_type: e.target.value }))}
                  className="w-full rounded-md border border-white/20 bg-slate-900 px-3 py-2 text-white"
                >
                  {INPUT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {draft.input_type !== 'short_text' && (
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-white">Options (one per line)</Label>
                  <Textarea
                    value={draft.optionsText}
                    onChange={(e) => setDraft((d) => ({ ...d, optionsText: e.target.value }))}
                    rows={4}
                    className="border-white/20 bg-white/5 text-white"
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-white">Sort order</Label>
                <Input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))}
                  className="border-white/20 bg-white/5 text-white"
                />
              </div>
              <div className="flex items-end gap-4 pb-1 text-sm text-white">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.is_required}
                    onChange={(e) => setDraft((d) => ({ ...d, is_required: e.target.checked }))}
                  />
                  Required
                </label>
              </div>
            </div>
            <Button
              type="submit"
              disabled={savingQuestion}
              className="bg-amber-400 text-slate-900 hover:bg-amber-300"
            >
              {savingQuestion ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add question
            </Button>
          </form>

          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{q.prompt}</p>
                    <p className="text-xs text-slate-400">
                      {q.field_key} · {q.input_type} · order {q.sort_order}
                      {q.is_active ? '' : ' · inactive'}
                      {q.is_required ? ' · required' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-white/30 text-white"
                      onClick={() =>
                        saveQuestion(q, {
                          is_active: !q.is_active,
                        })
                      }
                    >
                      <Save className="mr-1 h-3 w-3" />
                      {q.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-400/40 text-red-200"
                      onClick={() => deleteQuestion(q)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                </div>
                {Array.isArray(q.options) && q.options.length > 0 && (
                  <p className="text-sm text-blue-200">Options: {q.options.join(' · ')}</p>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};
