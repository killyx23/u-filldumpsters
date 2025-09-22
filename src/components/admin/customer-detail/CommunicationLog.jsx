import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { BookOpen, Clock, Loader2, CheckCircle, MessageSquare, Send, Reply, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from '@/components/ui/textarea';

const NoteBubble = ({ note, onReply }) => {
    const isAdmin = note.author_type === 'admin';
    return (
        <div className={`flex items-start gap-3 ${isAdmin ? 'flex-row-reverse' : ''}`}>
            <div className={`p-4 rounded-lg max-w-lg ${isAdmin ? 'bg-blue-800' : 'bg-gray-700'}`}>
                <div className="flex justify-between items-center mb-2">
                    <p className="font-semibold text-sm text-blue-200 flex items-center">
                        <BookOpen className="mr-2 h-4 w-4" />
                        {note.source}
                    </p>
                    <p className="text-xs text-gray-400">{format(parseISO(note.created_at), 'Pp')}</p>
                </div>
                <p className="text-white whitespace-pre-wrap">{note.content}</p>
                {note.booking_id && <p className="text-xs text-gray-500 mt-2">Booking #{note.booking_id}</p>}
                {!isAdmin && (
                    <div className="text-right mt-2">
                        <Button size="sm" variant="ghost" className="text-yellow-400 hover:text-yellow-300" onClick={() => onReply(note)}>
                            <Reply className="mr-2 h-4 w-4" /> Reply
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ReplyDialog = ({ isOpen, onOpenChange, onSend, targetNote, customer }) => {
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

    const handleSend = async () => {
        setIsSending(true);
        await onSend(message);
        setIsSending(false);
        setMessage('');
        onOpenChange(false);
    };

    const title = targetNote ? 'Reply to Customer' : 'Start New Conversation';
    const description = targetNote 
        ? `Replying to note from ${format(parseISO(targetNote.created_at), 'PPP')}.`
        : `Sending a new message to ${customer.name}.`;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Type your message here..."
                        rows={5}
                    />
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    <Button onClick={handleSend} disabled={isSending || !message.trim()}>
                        {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Send className="h-4 w-4 mr-2" />}
                        Send Message
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const CommunicationLog = ({ customer, notes, onUpdate, loading }) => {
    const [replyTarget, setReplyTarget] = useState(null);
    const [isReplyDialogOpen, setIsReplyDialogOpen] = useState(false);
    
    const conversationThreads = useMemo(() => {
        if (!notes) return [];
        const threads = {};
        notes.forEach(note => {
            const threadId = note.thread_id || note.id;
            if (!threads[threadId]) {
                threads[threadId] = [];
            }
            threads[threadId].push(note);
        });
        // Sort notes within each thread by creation date
        Object.values(threads).forEach(thread => thread.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)));

        // Sort threads by the date of the last note in the thread
        return Object.values(threads).sort((a, b) => {
            const lastNoteA = new Date(a[a.length - 1].created_at);
            const lastNoteB = new Date(b[b.length - 1].created_at);
            return lastNoteB - lastNoteA;
        });
    }, [notes]);

    const markAllAsRead = async () => {
        const unreadNoteIds = notes.filter(n => !n.is_read && n.author_type !== 'admin').map(n => n.id);
        if (unreadNoteIds.length === 0) return;

        const { error } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .in('id', unreadNoteIds);
        
        if (error) {
            toast({ title: 'Failed to mark notes as read', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'All notes marked as read!' });
            onUpdate();
        }
    };
    
    const handleReply = (note) => {
        setReplyTarget(note);
        setIsReplyDialogOpen(true);
    };

    const handleNewMessage = () => {
        setReplyTarget(null);
        setIsReplyDialogOpen(true);
    };

    const handleSendMessage = async (message) => {
        const payload = {
            customer_id: customer.id,
            content: message,
            thread_id: replyTarget ? replyTarget.thread_id : null,
            parent_note_id: replyTarget ? replyTarget.id : null,
            booking_id: replyTarget ? replyTarget.booking_id : null,
        };
        try {
            const { data, error } = await supabase.functions.invoke('send-admin-message', {
                body: payload
            });
            if (error) throw error;
            if (data.error) throw new Error(data.error);

            toast({ title: 'Message Sent!' });
            onUpdate();
        } catch(error) {
            toast({ title: 'Failed to send message', description: error.message, variant: 'destructive' });
        }
    };
    
    const hasUnreadNotes = notes.some(n => !n.is_read && n.author_type !== 'admin');

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="flex items-center text-xl font-bold text-yellow-400"><MessageSquare className="mr-2 h-5 w-5"/>Communication Log</h3>
                <div className="flex gap-2">
                    {hasUnreadNotes && (
                        <Button size="sm" onClick={markAllAsRead} variant="outline" className="text-yellow-400 border-yellow-400 hover:bg-yellow-400 hover:text-black">
                           <CheckCircle className="mr-2 h-4 w-4"/> Mark All as Read
                        </Button>
                    )}
                    <Button size="sm" onClick={handleNewMessage}>
                        <PlusCircle className="mr-2 h-4 w-4"/> New Message
                    </Button>
                </div>
            </div>
            {loading ? (
                <div className="flex justify-center items-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                </div>
            ) : (
                <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                    {conversationThreads.length > 0 ? (
                        conversationThreads.map((thread, index) => (
                            <div key={index} className="p-4 bg-black/20 rounded-lg space-y-4">
                                {thread.map(note => <NoteBubble key={note.id} note={note} onReply={handleReply} />)}
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-blue-200 py-16">No notes or correspondence history for this customer.</p>
                    )}
                </div>
            )}
            <ReplyDialog 
                isOpen={isReplyDialogOpen} 
                onOpenChange={setIsReplyDialogOpen}
                onSend={handleSendMessage}
                targetNote={replyTarget}
                customer={customer}
            />
        </div>
    );
};