import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

const SIGNED_URL_TTL_SECONDS = 3600;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function useRealTimeChat(customerId) {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    
    const conversationId = `cust_${customerId}`;
    const channelRef = useRef(null);

    const isAbsoluteUrl = useCallback((value) => (
        typeof value === 'string' && /^https?:\/\//i.test(value)
    ), []);

    const resolveAttachmentUrl = useCallback(async (attachmentValue) => {
        if (!attachmentValue) return null;
        if (isAbsoluteUrl(attachmentValue)) return attachmentValue;

        const { data, error: signedUrlError } = await supabase
            .storage
            .from('customer-uploads')
            .createSignedUrl(attachmentValue, SIGNED_URL_TTL_SECONDS);

        if (signedUrlError) {
            console.warn('[useRealTimeChat] Failed to create signed URL:', signedUrlError);
            return null;
        }

        return data?.signedUrl || null;
    }, [isAbsoluteUrl]);

    const hydrateMessageAttachment = useCallback(async (message) => {
        if (!message?.attachment_url) {
            return { ...message, resolved_attachment_url: null };
        }

        const resolvedUrl = await resolveAttachmentUrl(message.attachment_url);
        return { ...message, resolved_attachment_url: resolvedUrl };
    }, [resolveAttachmentUrl]);

    const hydrateMessagesAttachments = useCallback(async (rows) => {
        if (!rows || rows.length === 0) return [];
        return Promise.all(rows.map(hydrateMessageAttachment));
    }, [hydrateMessageAttachment]);

    const fetchMessages = useCallback(async () => {
        if (!customerId) return;
        setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });
                
            if (fetchError) throw fetchError;

            const hydratedMessages = await hydrateMessagesAttachments(data || []);
            setMessages(hydratedMessages);
            setError(null);
        } catch (err) {
            console.error("Error fetching messages:", err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [conversationId, customerId, hydrateMessagesAttachments]);

    const setupSubscription = useCallback(() => {
        if (!customerId) return;

        setConnectionStatus('connecting');
        const channelName = `conversation:${conversationId}`;

        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }

        // Subscribes EXCLUSIVELY to chat_messages table
        channelRef.current = supabase.channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    void (async () => {
                        const hydratedNew = await hydrateMessageAttachment(payload.new);
                        setMessages(prev => {
                            if (prev.some(m => m.id === hydratedNew.id)) return prev;
                            return [...prev, hydratedNew].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                        });
                    })();
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    void (async () => {
                        const hydratedUpdate = await hydrateMessageAttachment(payload.new);
                        setMessages(prev => prev.map(m => m.id === hydratedUpdate.id ? { ...m, ...hydratedUpdate } : m));
                    })();
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setConnectionStatus('connected');
                } else if (status === 'CLOSED') {
                    setConnectionStatus('disconnected');
                } else if (status === 'CHANNEL_ERROR') {
                    setConnectionStatus('error');
                }
            });
    }, [conversationId, customerId, hydrateMessageAttachment]);

    useEffect(() => {
        fetchMessages();
        setupSubscription();

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }
        };
    }, [fetchMessages, setupSubscription]);

    const sendMessage = useCallback(async (content, senderType, attachment = null) => {
        const messageId = generateUUID();
        
        const dbPayload = {
            id: messageId,
            conversation_id: conversationId,
            customer_id: customerId,
            sender_type: senderType,
            message_content: content,
            attachment_url: attachment?.path || attachment?.url || null,
            attachment_name: attachment?.name || null,
            is_read: false
        };

        const newMessage = {
            ...dbPayload,
            resolved_attachment_url: attachment?.url || null,
            created_at: new Date().toISOString()
        };

        // Optimistic update
        setMessages(prev => [...prev, newMessage]);

        try {
            const { data, error } = await supabase.from('chat_messages').insert([dbPayload]).select().single();
            if (error) throw error;
            const hydratedData = await hydrateMessageAttachment(data);
            setMessages(prev => prev.map(m => m.id === messageId ? hydratedData : m));
            return hydratedData;
        } catch (err) {
            console.error("Error sending message:", err);
            setMessages(prev => prev.filter(m => m.id !== messageId));
            throw err;
        }
    }, [conversationId, customerId, hydrateMessageAttachment]);

    const markAsRead = useCallback(async (messageIds) => {
        if (!messageIds || messageIds.length === 0) return;
        try {
            await supabase.from('chat_messages').update({ is_read: true }).in('id', messageIds);
        } catch (err) {
            console.error("Error marking messages as read:", err);
        }
    }, []);

    const reconnect = useCallback(() => {
        setupSubscription();
    }, [setupSubscription]);

    return { 
        messages, 
        isLoading, 
        error, 
        connectionStatus, 
        sendMessage, 
        markAsRead,
        reconnect
    };
}