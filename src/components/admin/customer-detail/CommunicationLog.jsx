import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { MessageSquare, Loader2, Send, Paperclip, Smile, FileText, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';

const AttachmentPreview = ({ note }) => {
    if (!note.attachment_url) return null;

    const isImage = /\.(jpg|jpeg|png|gif)$/i.test(note.attachment_name);

    if (isImage) {
        return (
            <a href={note.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                <img-replace src={note.attachment_url} alt={note.attachment_name} className="max-w-xs rounded-lg" />
            </a>
        );
    }

    return (
        <a href={note.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 p-2 bg-black/20 rounded-lg hover:bg-black/40 transition-colors">
            <FileText className="h-6 w-6 text-yellow-400" />
            <span className="text-sm font-medium truncate">{note.attachment_name}</span>
        </a>
    );
};

const ChatBubble = ({ note, isFirstInGroup }) => {
    const isAdmin = note.author_type === 'admin';
    const bubbleClasses = isAdmin
        ? 'bg-blue-600 text-white rounded-br-none'
        : 'bg-gray-700 text-white rounded-bl-none';
    const marginClass = isFirstInGroup ? 'mt-4' : 'mt-1';

    return (
        <div className={`flex items-end gap-2 ${isAdmin ? 'justify-end' : 'justify-start'} ${marginClass}`}>
            <div className={`p-3 rounded-lg max-w-md md:max-w-lg ${bubbleClasses}`}>
                <p className="font-semibold text-sm text-blue-200">{note.source}</p>
                {note.content && <p className="text-sm whitespace-pre-wrap mt-1">{note.content}</p>}
                <AttachmentPreview note={note} />
                <p className="text-xs mt-1 text-right opacity-70">{format(parseISO(note.created_at), 'p')}</p>
            </div>
        </div>
    );
};

const DateSeparator = ({ date }) => {
    const formatDate = (d) => {
        const parsedDate = parseISO(d);
        if (isToday(parsedDate)) return 'Today';
        if (isYesterday(parsedDate)) return 'Yesterday';
        return format(parsedDate, 'MMMM d, yyyy');
    };

    return (
        <div className="relative my-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-gray-600" />
            </div>
            <div className="relative flex justify-center">
                <span className="bg-gray-800 px-2 text-sm text-gray-400">{formatDate(date)}</span>
            </div>
        </div>
    );
};

export const CommunicationLog = ({ customer, initialNotes, onUpdate }) => {
    const [notes, setNotes] = useState(initialNotes);
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        setNotes(initialNotes);
    }, [initialNotes]);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [notes]);

    const markNotesAsRead = useCallback(async () => {
        const unreadNoteIds = notes.filter(n => !n.is_read && n.author_type === 'customer').map(n => n.id);
        if (unreadNoteIds.length === 0) return;

        const { error } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .in('id', unreadNoteIds);
        
        if (!error) {
            onUpdate();
        }
    }, [notes, onUpdate]);

    useEffect(() => {
        const hasUnread = notes.some(n => !n.is_read && n.author_type === 'customer');
        if (hasUnread) {
            const timer = setTimeout(() => {
                markNotesAsRead();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [notes, markNotesAsRead]);

    const handleSendMessage = async (attachment = null) => {
        if (!message.trim() && !attachment) return;
        setIsSending(true);

        const payload = {
            customer_id: customer.id,
            content: message.trim(),
            attachment_url: attachment?.url || null,
            attachment_name: attachment?.name || null,
        };

        try {
            const { error } = await supabase.functions.invoke('send-admin-message', {
                body: payload
            });
            if (error) throw error;

            setMessage('');
        } catch (error) {
            toast({ title: 'Failed to send message', description: error.message, variant: 'destructive' });
        } finally {
            setIsSending(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsSending(true);
        const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;
        
        try {
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            
            await handleSendMessage({ url: publicUrl, name: file.name });

        } catch (error) {
            toast({ title: "Attachment Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSending(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleTextareaKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const onEmojiClick = (emojiObject) => {
        setMessage(prevMessage => prevMessage + emojiObject.emoji);
    };

    const groupedNotes = useMemo(() => {
        const groups = [];
        let lastDate = null;
        let lastAuthor = null;
        
        [...notes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(note => {
            const noteDate = format(parseISO(note.created_at), 'yyyy-MM-dd');
            if (noteDate !== lastDate) {
                groups.push({ type: 'date', date: noteDate });
                lastDate = noteDate;
                lastAuthor = null; 
            }

            const isFirstInGroup = note.author_type !== lastAuthor;
            groups.push({ type: 'note', note, isFirstInGroup });
            lastAuthor = note.author_type;
        });
        return groups;
    }, [notes]);

    return (
        <div className="flex flex-col h-[75vh] bg-gray-800 rounded-lg shadow-2xl">
            <header className="p-4 border-b border-gray-700">
                <h3 className="flex items-center text-lg font-bold text-yellow-400">
                    <MessageSquare className="mr-2 h-5 w-5" />
                    Chat with {customer.name}
                </h3>
            </header>

            <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto">
                {groupedNotes.map((group, index) => {
                    if (group.type === 'date') {
                        return <DateSeparator key={`date-${index}`} date={group.date} />;
                    }
                    return (
                        <ChatBubble
                            key={group.note.id}
                            note={group.note}
                            isFirstInGroup={group.isFirstInGroup}
                        />
                    );
                })}
            </div>

            <footer className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg">
                <div className="relative">
                    <Textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleTextareaKeyDown}
                        placeholder="Type a message... (Shift+Enter for new line)"
                        className="bg-gray-700 border-gray-600 text-white rounded-lg pr-28 resize-none"
                        rows={1}
                        onInput={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = `${e.target.scrollHeight}px`;
                        }}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white">
                                    <Smile className="h-5 w-5" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 border-0 bg-transparent">
                                <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                            </PopoverContent>
                        </Popover>
                        <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => fileInputRef.current?.click()}>
                            <Paperclip className="h-5 w-5" />
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                        <Button size="icon" onClick={() => handleSendMessage()} disabled={isSending || (!message.trim() && !fileInputRef.current?.files?.length)}>
                            {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                        </Button>
                    </div>
                </div>
            </footer>
        </div>
    );
};