
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export function useTypingIndicator(customerId, currentUserType) {
    const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
    const typingTimeoutRef = useRef(null);
    const conversationId = `cust_${customerId}`;

    useEffect(() => {
        if (!customerId) return;

        // Initialize record if not exists (upsert behavior)
        const initRecord = async () => {
            await supabase.from('typing_indicators').upsert(
                { conversation_id: conversationId },
                { onConflict: 'conversation_id', ignoreDuplicates: true }
            );
        };
        initRecord();

        const channel = supabase.channel(`typing_${conversationId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'typing_indicators',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    if (currentUserType === 'admin') {
                        setIsOtherUserTyping(payload.new.customer_is_typing);
                    } else {
                        setIsOtherUserTyping(payload.new.admin_is_typing);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            // Cleanup typing status on unmount
            updateTypingStatus(false);
        };
    }, [conversationId, currentUserType, customerId]);

    const updateTypingStatus = async (isTyping) => {
        const updateData = currentUserType === 'admin' 
            ? { admin_is_typing: isTyping, updated_at: new Date().toISOString() }
            : { customer_is_typing: isTyping, updated_at: new Date().toISOString() };
            
        await supabase
            .from('typing_indicators')
            .update(updateData)
            .eq('conversation_id', conversationId);
    };

    const setIsTyping = useCallback(() => {
        updateTypingStatus(true);
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        
        typingTimeoutRef.current = setTimeout(() => {
            updateTypingStatus(false);
        }, 3000);
    }, [conversationId, currentUserType]);

    const typingIndicatorText = isOtherUserTyping 
        ? `${currentUserType === 'admin' ? 'Customer' : 'Support Team'} is typing...` 
        : '';

    return { isOtherUserTyping, setIsTyping, typingIndicatorText };
}
