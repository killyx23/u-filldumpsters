import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { MessageSquare, Loader2, Send, Paperclip, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';
import { useRealTimeChat } from '@/hooks/useRealTimeChat';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ConnectionStatus } from '@/components/ConnectionStatus';

export const CommunicationLog = ({ customer }) => {
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);

    const { messages, sendMessage, markAsRead, isLoading, connectionStatus, reconnect } = useRealTimeChat(customer.id);

    // Auto-scroll to bottom
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Mark unread messages from customer as read when viewing them
    useEffect(() => {
        const unreadIds = messages.filter(m => m.sender_type === 'customer' && !m.is_read).map(m => m.id);
        if (unreadIds.length > 0) {
            markAsRead(unreadIds);
        }
    }, [messages, markAsRead]);

    const handleSend = async (attachment = null) => {
        if (!input.trim() && !attachment) return;
        try {
            await sendMessage(input.trim(), 'admin', attachment);
            setInput('');
        } catch (error) {
            toast({ title: 'Send Failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;
        
        try {
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            await handleSend({ url: publicUrl, name: file.name });
        } catch (error) {
            toast({ title: "Attachment Failed", description: error.message, variant: "destructive" });
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
        setInput(prev => prev + emojiObject.emoji);
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
                {isLoading && messages.length === 0 ? (
                    <div className="flex justify-center items-center h-full">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-3">
                        <MessageSquare className="h-12 w-12 opacity-20" />
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <MessageBubble 
                            key={msg.id} 
                            message={msg} 
                            isCurrentUser={msg.sender_type === 'admin'} 
                            senderName={customer.name} 
                        />
                    ))
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