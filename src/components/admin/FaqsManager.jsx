import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit, Trash2, Save, GripVertical, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';
import { motion, AnimatePresence } from 'framer-motion';

const FaqForm = ({ faq, onSave, onCancel, open }) => {
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setQuestion(faq?.question || '');
            setAnswer(faq?.answer || '');
        }
    }, [faq, open]);

    const onEmojiClick = (emojiObject) => {
        setAnswer(prevAnswer => prevAnswer + emojiObject.emoji);
    };

    const handleSave = async () => {
        if (!question.trim() || !answer.trim()) {
            toast({ title: "Validation Error", description: "Question and answer cannot be empty.", variant: "destructive" });
            return;
        }
        setIsSaving(true);
        await onSave({ ...faq, question, answer });
        setIsSaving(false);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
            <DialogHeader>
                <DialogTitle>{faq ? 'Edit FAQ' : 'Create New FAQ'}</DialogTitle>
                <DialogDescription>
                    Fill in the details for the frequently asked question.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label htmlFor="question">Question</Label>
                    <Input id="question" value={question} onChange={e => setQuestion(e.target.value)} className="bg-white/10" />
                </div>
                <div className="relative">
                    <Label htmlFor="answer">Answer</Label>
                    <Textarea id="answer" value={answer} onChange={e => setAnswer(e.target.value)} rows={6} className="bg-white/10 pr-10" />
                     <Popover>
                        <PopoverTrigger asChild>
                            <Button size="icon" variant="ghost" className="absolute bottom-2 right-1 text-gray-400 hover:text-white">
                                <Smile className="h-5 w-5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 border-0 bg-transparent mb-2">
                            <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                        </PopoverContent>
                    </Popover>
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

    const handleDragEnd = async () => {
        if (draggedItem === null || dragOverItem === null || draggedItem === dragOverItem) {
            setDraggedItem(null);
            setDragOverItem(null);
            return;
        }

        let items = [...faqs];
        const draggedContent = items.splice(draggedItem, 1)[0];
        items.splice(dragOverItem, 0, draggedContent);

        setFaqs(items);

        const updates = items.map((faq, index) => ({
            id: faq.id,
            position: index,
        }));

        const { error } = await supabase.from('faqs').upsert(updates);
        if (error) {
            toast({ title: 'Failed to reorder FAQs', description: error.message, variant: 'destructive' });
            fetchFaqs(); // Revert on error
        } else {
            toast({ title: 'Order saved!' });
        }
        setDraggedItem(null);
        setDragOverItem(null);
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
                            className={`bg-white/5 p-4 rounded-lg flex items-center justify-between gap-4 ${draggedItem === index ? 'opacity-50' : ''}`}
                            draggable
                            onDragStart={() => setDraggedItem(index)}
                            onDragEnter={() => setDragOverItem(index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="flex items-center gap-4 flex-grow">
                                <GripVertical className="h-5 w-5 text-gray-400 cursor-grab" />
                                <div className="flex-grow">
                                    <p className="font-bold">{faq.question}</p>
                                    <p className="text-sm text-blue-200 line-clamp-1">{faq.answer}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
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