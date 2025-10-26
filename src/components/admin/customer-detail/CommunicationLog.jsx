import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { MessageSquare, Loader2, Send, Paperclip, Smile, FileText } from 'lucide-react';
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
                <img src={note.attachment_url} alt={note.attachment_name} className="max-w-xs rounded-lg" />
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

const ChatBubble = ({ note, customerName }) => {
    const isAdmin = note.author_type === 'admin';
    const bubbleClasses = isAdmin
        ? 'bg-blue-600 text-white self-end rounded-lg rounded-br-none'
        : 'bg-gray-700 text-white self-start rounded-lg rounded-bl-none';
    
    const sourceText = isAdmin ? 'Scheduling' : customerName;

    return (
        <div className={`flex flex-col gap-1 w-full my-1`}>
            <div className={`p-3 max-w-md md:max-w-lg ${bubbleClasses}`}>
                <p className="font-semibold text-sm text-yellow-300">{sourceText}</p>
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

export const CommunicationLog = ({ customer, initialNotes, onMessageSent }) => {
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [initialNotes]);

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
            const { data: newMessage, error } = await supabase.functions.invoke('send-admin-message', {
                body: payload
            });
            
            if (error) {
                const errorContext = await error.context.json();
                throw new Error(errorContext.error || 'The function returned an error.');
            }
            
            if(onMessageSent) {
                onMessageSent(newMessage);
            }
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
        
        [...initialNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(note => {
            const noteDate = format(parseISO(note.created_at), 'yyyy-MM-dd');
            if (noteDate !== lastDate) {
                groups.push({ type: 'date', date: noteDate });
                lastDate = noteDate;
            }
            groups.push({ type: 'note', note });
        });
        return groups;
    }, [initialNotes]);

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
                            customerName={customer.name}
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