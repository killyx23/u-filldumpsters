
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export function useRealTimeChat(customerId) {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    
    const conversationId = `cust_${customerId}`;

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
            setMessages(data || []);
            setError(null);
        } catch (err) {
            console.error("Error fetching messages:", err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [conversationId, customerId]);

    useEffect(() => {
        fetchMessages();

        if (!customerId) return;

        const channel = supabase.channel(`chat_${conversationId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        setMessages(prev => {
                            // Prevent duplicates if optimistic update already added it
                            if (prev.some(m => m.id === payload.new.id)) return prev;
                            return [...prev, payload.new];
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
                    }
                }
            )
            .subscribe((status) => {
                setIsConnected(status === 'SUBSCRIBED');
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [conversationId, customerId, fetchMessages]);

    const sendMessage = async (content, senderType, attachment = null) => {
        const tempId = `temp_${Date.now()}`;
        const newMessage = {
            id: tempId,
            conversation_id: conversationId,
            customer_id: customerId,
            sender_type: senderType,
            message_content: content,
            attachment_url: attachment?.url || null,
            attachment_name: attachment?.name || null,
            is_read: false,
            created_at: new Date().toISOString(),
            status: 'sending'
        };

        // Optimistic update
        setMessages(prev => [...prev, newMessage]);

        try {
            const { data, error } = await supabase
                .from('chat_messages')
                .insert([{
                    conversation_id: conversationId,
                    customer_id: customerId,
                    sender_type: senderType,
                    message_content: content,
                    attachment_url: attachment?.url || null,
                    attachment_name: attachment?.name || null
                }])
                .select()
                .single();

            if (error) throw error;

            // Update temp message with real DB message
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'delivered' } : m));
            return data;
        } catch (err) {
            console.error("Error sending message:", err);
            // Mark as failed
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'error' } : m));
            throw err;
        }
    };

    const markAsRead = async (messageIds) => {
        if (!messageIds || messageIds.length === 0) return;
        try {
            await supabase
                .from('chat_messages')
                .update({ is_read: true })
                .in('id', messageIds);
        } catch (err) {
            console.error("Error marking messages as read:", err);
        }
    };

    return { messages, sendMessage, markAsRead, isLoading, error, isConnected, refetch: fetchMessages };
}
