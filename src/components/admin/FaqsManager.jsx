import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit, Trash2, Save, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { FaqRichAnswerEditor } from '@/components/admin/FaqRichAnswerEditor';
import { answerHasContent, stripHtml } from '@/utils/faqAnswer';

const FaqForm = ({ faq, onSave, onCancel, open }) => {
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState('');
    const [sessionKey, setSessionKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setQuestion(faq?.question || '');
            setAnswer(faq?.answer || '');
            setSessionKey(`${faq?.id || 'new'}-${Date.now()}`);
        }
    }, [faq, open]);

    const handleSave = async () => {
        if (!question.trim() || !answerHasContent(answer)) {
            toast({ title: "Validation Error", description: "Question and answer cannot be empty.", variant: "destructive" });
            return;
        }
        setIsSaving(true);
        await onSave({ ...faq, question, answer });
        setIsSaving(false);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>{faq ? 'Edit FAQ' : 'Create New FAQ'}</DialogTitle>
                <DialogDescription>
                    Write the answer with formatting, colors, and tables. Use the comparison-table button for a side-by-side chart.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label htmlFor="question">Question</Label>
                    <Input id="question" value={question} onChange={e => setQuestion(e.target.value)} className="bg-white/10" />
                </div>
                <div>
                    <Label htmlFor="answer">Answer</Label>
                    {open && sessionKey ? (
                        <FaqRichAnswerEditor sessionKey={sessionKey} value={answer} onChange={setAnswer} />
                    ) : null}
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="ghost" onClick={onCancel}>Cancel</Button></DialogClose>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save FAQ
                </Button>
            </DialogFooter>
        </DialogContent>
    );
};

export const FaqsManager = () => {
    const [faqs, setFaqs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingFaq, setEditingFaq] = useState(null);
    const [draggedItem, setDraggedItem] = useState(null);
    const [dragOverItem, setDragOverItem] = useState(null);
    const [savingOrder, setSavingOrder] = useState(false);
    const draggedIndexRef = useRef(null);
    const dragOverIndexRef = useRef(null);

    const fetchFaqs = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('faqs').select('*').order('position');
        if (error) {
            toast({ title: "Failed to load FAQs", description: error.message, variant: "destructive" });
        } else {
            setFaqs(data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchFaqs();
    }, [fetchFaqs]);

    const handleSaveFaq = async (faqData) => {
        const payload = {
            question: faqData.question,
            answer: faqData.answer,
        };

        let query;
        if (faqData.id) {
            query = supabase.from('faqs').update(payload).eq('id', faqData.id);
        } else {
            query = supabase.from('faqs').insert([{ ...payload, position: faqs.length }]);
        }

        const { error } = await query;
        if (error) {
            toast({ title: 'Failed to save FAQ', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `FAQ ${faqData.id ? 'updated' : 'created'} successfully!` });
            setIsFormOpen(false);
            setEditingFaq(null);
            fetchFaqs();
        }
    };

    const handleDeleteFaq = async (id) => {
        if (!window.confirm("Are you sure you want to delete this FAQ? This action cannot be undone.")) return;

        const { error } = await supabase.from('faqs').delete().eq('id', id);
        if (error) {
            toast({ title: 'Failed to delete FAQ', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'FAQ deleted successfully' });
            fetchFaqs();
        }
    };

    const persistOrder = async (items) => {
        setFaqs(items);
        setSavingOrder(true);
        const results = await Promise.all(
            items.map((faq, index) =>
                supabase.from('faqs').update({ position: index }).eq('id', faq.id)
            )
        );
        const failed = results.find((result) => result.error);
        setSavingOrder(false);
        if (failed) {
            toast({ title: 'Failed to reorder FAQs', description: failed.error.message, variant: 'destructive' });
            fetchFaqs();
            return;
        }
        toast({ title: 'Order saved!' });
    };

    const moveFaq = (index, direction) => {
        const target = index + direction;
        if (savingOrder || target < 0 || target >= faqs.length) return;
        const items = [...faqs];
        const [moved] = items.splice(index, 1);
        items.splice(target, 0, moved);
        persistOrder(items);
    };

    const handleDragEnd = () => {
        const from = draggedIndexRef.current;
        const to = dragOverIndexRef.current;
        draggedIndexRef.current = null;
        dragOverIndexRef.current = null;
        setDraggedItem(null);
        setDragOverItem(null);
        if (from === null || to === null || from === to || savingOrder) return;

        const items = [...faqs];
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        persistOrder(items);
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    return (
        <div className="bg-white/10 p-6 rounded-2xl">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Manage FAQs</h2>
                <Button onClick={() => { setEditingFaq(null); setIsFormOpen(true); }}>
                    <Plus className="mr-2 h-4 w-4" /> Add New FAQ
                </Button>
            </div>
            <div className="space-y-3">
                <AnimatePresence>
                    {faqs.map((faq, index) => (
                        <motion.div
                            key={faq.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`bg-white/5 p-4 rounded-lg flex items-center justify-between gap-4 ${draggedItem === index ? 'opacity-50' : ''} ${dragOverItem === index && draggedItem !== index ? 'ring-2 ring-yellow-400' : ''}`}
                            onDragEnter={() => {
                                dragOverIndexRef.current = index;
                                setDragOverItem(index);
                            }}
                            onDragOver={(event) => event.preventDefault()}
                        >
                            <div className="flex items-center gap-4 flex-grow">
                                <div
                                    draggable={!savingOrder}
                                    aria-label="Drag to reorder"
                                    className="cursor-grab text-gray-400 active:cursor-grabbing"
                                    onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', String(index));
                                        draggedIndexRef.current = index;
                                        dragOverIndexRef.current = index;
                                        setDraggedItem(index);
                                    }}
                                    onDragEnd={handleDragEnd}
                                >
                                    <GripVertical className="h-5 w-5" />
                                </div>
                                <div className="flex-grow">
                                    <p className="font-bold">{faq.question}</p>
                                    <p className="text-sm text-blue-200 line-clamp-1">{stripHtml(faq.answer)}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label="Move up"
                                    disabled={savingOrder || index === 0}
                                    onClick={() => moveFaq(index, -1)}
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label="Move down"
                                    disabled={savingOrder || index === faqs.length - 1}
                                    onClick={() => moveFaq(index, 1)}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => { setEditingFaq(faq); setIsFormOpen(true); }}>
                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => handleDeleteFaq(faq.id)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </Button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
            
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <FaqForm
                    open={isFormOpen}
                    faq={editingFaq}
                    onSave={handleSaveFaq}
                    onCancel={() => { setIsFormOpen(false); setEditingFaq(null); }}
                />
            </Dialog>
        </div>
    );
};