import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { MessageSquare, Loader2, Send, Paperclip, Smile, BookOpen, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';
import { format, parseISO } from 'date-fns';
import { useRealTimeChat } from '@/hooks/useRealTimeChat';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { ChangeRequestNoteContent } from '@/components/admin/customer-detail/ChangeRequestNoteContent';

const CHAT_NOTE_SOURCES = new Set([
    'Verification Skip Reason',
    'Verification Completed',
    'Change Request',
    'Booking Special Instructions',
    'Booking Cancellation & Refund',
    'Cancellation Request',
    'Reschedule Approved',
    'Address Change',
    'Contact Form Inquiry',
    // 'How Can We Do Better' intentionally omitted — rich chat card already shows survey answers
]);

const noteSourceLabel = (source) => {
    if (source === 'Change Request') return 'Scheduling Change Request';
    if (source === 'Contact Form Inquiry') return 'Contact Form Inquiry';
    return source;
};

const NoteFeedItem = ({ note, customerName }) => {
    const isAdminNote = note.author_type === 'admin';
    const isVerificationResolved = note.source === 'Verification Completed';
    const isContactInquiry = note.source === 'Contact Form Inquiry';
    const needsCustomerReview = !isAdminNote && !note.is_read && !isVerificationResolved;
    const footer = (() => {
        if (isVerificationResolved) {
            return 'Verification taken care of — no pending action';
        }
        if (isContactInquiry && needsCustomerReview) {
            return `Contact form from ${customerName} — needs review`;
        }
        if (needsCustomerReview) {
            return `From ${customerName} — needs review`;
        }
        if (isAdminNote && note.source === 'Reschedule Approved') {
            return 'From scheduling department — approved';
        }
        if (isAdminNote) {
            return 'From scheduling department';
        }
        return null;
    })();

    return (
        <div
            className={`mb-4 p-4 rounded-lg ${
                isVerificationResolved
                    ? 'bg-green-900/25 border border-green-500/40'
                    : needsCustomerReview
                    ? 'bg-yellow-900/30 border border-yellow-500/50'
                    : 'bg-white/5'
            }`}
        >
            <div className="flex items-center gap-2 mb-2">
                <BookOpen className={`h-4 w-4 ${isVerificationResolved ? 'text-green-400' : 'text-yellow-400'}`} />
                <span className={`font-semibold text-sm ${isVerificationResolved ? 'text-green-300' : 'text-yellow-300'}`}>
                    {noteSourceLabel(note.source)}
                </span>
                <span className="text-xs text-gray-400 flex items-center ml-auto">
                    <Clock className="h-3 w-3 mr-1" />
                    {format(parseISO(note.created_at), 'MMM d, yyyy @ h:mm a')}
                </span>
            </div>
            <ChangeRequestNoteContent content={note.content} source={note.source} />
            {note.booking_id && (
                <p className="text-xs text-gray-500 mt-2">Related to Booking #{note.booking_id}</p>
            )}
            {footer && (
                <p
                    className={`text-xs mt-2 ${
                        isVerificationResolved
                            ? 'text-green-400'
                            : needsCustomerReview
                              ? 'text-yellow-400'
                              : 'text-blue-300'
                    }`}
                >
                    {footer}
                </p>
            )}
        </div>
    );
};

export const CommunicationLog = ({ customer, initialNotes = [], onUpdate }) => {
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [notes, setNotes] = useState(initialNotes);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);
    const onUpdateRef = useRef(onUpdate);
    const clearedUnreadRef = useRef(false);

    const { messages, sendMessage, markAsRead, isLoading, connectionStatus, reconnect } = useRealTimeChat(customer.id);
    const { isOtherUserTyping, setIsTyping, clearTyping, typingIndicatorText } = useTypingIndicator(customer.id, 'admin');

    useEffect(() => {
        onUpdateRef.current = onUpdate;
    }, [onUpdate]);

    useEffect(() => {
        setNotes(initialNotes);
    }, [initialNotes]);

    useEffect(() => {
        clearedUnreadRef.current = false;
    }, [customer?.id]);

    // If new unread arrives while Chat is open, allow another clear pass
    useEffect(() => {
        if (customer?.has_unread_notes) {
            clearedUnreadRef.current = false;
        }
    }, [customer?.has_unread_notes]);

    const relevantNotes = useMemo(
        () => notes.filter((note) => CHAT_NOTE_SOURCES.has(note.source)),
        [notes]
    );

    const feedItems = useMemo(() => {
        const chatItems = messages.map((msg) => ({
            kind: 'chat',
            id: `chat-${msg.id}`,
            created_at: msg.created_at,
            data: msg,
        }));
        const noteItems = relevantNotes.map((note) => ({
            kind: 'note',
            id: `note-${note.id}`,
            created_at: note.created_at,
            data: note,
        }));
        return [...chatItems, ...noteItems].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
        );
    }, [messages, relevantNotes]);

    const clearAdminUnreadBadges = useCallback(async () => {
        if (!customer?.id || clearedUnreadRef.current) return;

        // Mark ALL unread customer-authored notes (not just chat-feed sources)
        const { data: updatedNotes, error: notesError } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .eq('customer_id', customer.id)
            .eq('author_type', 'customer')
            .eq('is_read', false)
            .select('id');

        if (notesError) {
            console.error('Failed to mark notes as read:', notesError);
            return;
        }

        const unreadNoteIds = (updatedNotes || []).map((note) => note.id);
        if (unreadNoteIds.length > 0) {
            setNotes((prev) =>
                prev.map((note) =>
                    unreadNoteIds.includes(note.id) ? { ...note, is_read: true } : note
                )
            );
        }

        // Safety net for stuck flags (e.g. admin notes that flipped has_unread_notes)
        const { error: clearError } = await supabase
            .from('customers')
            .update({ has_unread_notes: false })
            .eq('id', customer.id);

        if (clearError) {
            console.error('Failed to clear has_unread_notes:', clearError);
            return;
        }

        clearedUnreadRef.current = true;
        onUpdateRef.current?.();
    }, [customer?.id]);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [feedItems, isOtherUserTyping]);

    useEffect(() => {
        const unreadIds = messages.filter((m) => m.sender_type === 'customer' && !m.is_read).map((m) => m.id);
        if (unreadIds.length > 0) {
            markAsRead(unreadIds);
        }
    }, [messages, markAsRead]);

    useEffect(() => {
        clearAdminUnreadBadges();
    }, [clearAdminUnreadBadges]);

    const handleSend = async (attachment = null) => {
        if (!input.trim() && !attachment) return;
        try {
            await sendMessage(input.trim(), 'admin', attachment);
            setInput('');
            clearTyping();
        } catch (error) {
            toast({ title: 'Send Failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleInputChange = (e) => {
        setInput(e.target.value);
        setIsTyping();
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;

        try {
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
            if (uploadError) throw uploadError;

            await handleSend({ path: filePath, name: file.name });
        } catch (error) {
            toast({ title: 'Attachment Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const onEmojiClick = (emojiObject) => {
        setInput((prev) => prev + emojiObject.emoji);
        setIsTyping();
    };

    return (
        <div className="flex flex-col h-[75vh] bg-gray-800 rounded-lg shadow-2xl border border-gray-700">
            <header className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50 rounded-t-lg">
                <h3 className="flex items-center text-lg font-bold text-yellow-400">
                    <MessageSquare className="mr-2 h-5 w-5" />
                    Chat with {customer.name}
                </h3>
                <div className="flex items-center gap-3">
                    <ConnectionStatus status={connectionStatus} onReconnect={reconnect} />
                </div>
            </header>

            <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto chat-scroll-container">
                {isLoading && feedItems.length === 0 ? (
                    <div className="flex justify-center items-center h-full">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                    </div>
                ) : feedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-3">
                        <MessageSquare className="h-12 w-12 opacity-20" />
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    <>
                        {feedItems.map((item) =>
                            item.kind === 'chat' ? (
                                <MessageBubble
                                    key={item.id}
                                    message={item.data}
                                    isCurrentUser={item.data.sender_type === 'admin'}
                                    senderName={customer.name}
                                />
                            ) : (
                                <NoteFeedItem key={item.id} note={item.data} customerName={customer.name} />
                            )
                        )}
                        <TypingIndicator isTyping={isOtherUserTyping} text={typingIndicatorText} />
                    </>
                )}
            </div>

            <footer className="p-3 border-t border-gray-700 bg-gray-900 rounded-b-lg">
                <div className="relative">
                    <Textarea
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message... (Shift+Enter for new line)"
                        className="bg-gray-800 border-gray-600 text-white rounded-lg pr-28 resize-none min-h-[50px] max-h-[150px]"
                        rows={1}
                        onInput={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                        }}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-gray-800 rounded-lg px-1">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white h-8 w-8">
                                    <Smile className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 border-0 bg-transparent mb-2 mr-2">
                                <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                            </PopoverContent>
                        </Popover>
                        <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white h-8 w-8" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                        <Button size="icon" className="h-8 w-8 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleSend()} disabled={isUploading || (!input.trim() && !fileInputRef.current?.files?.length)}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </footer>
        </div>
    );
};
