// DEPRECATED: Typing indicators have been disabled to consolidate the messaging system,
// reduce Supabase Realtime broadcast noise, and prevent interference with message syncing.
export function useTypingIndicator(customerId) {
    return { 
        isAdminTyping: false, 
        isCustomerTyping: false, 
        setAdminTyping: () => {}, 
        setCustomerTyping: () => {} 
    };
}