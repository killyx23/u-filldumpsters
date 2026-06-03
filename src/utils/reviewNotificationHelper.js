import { supabase } from '@/lib/customSupabaseClient';

export const buildReviewApprovedChatMessage = (review) => {
    const bookingId = review.booking_id;
    return (
        `Thank you for taking the time to share your feedback with U-Fill Dumpsters. ` +
        `Your review for Booking #${bookingId} has been approved and is now live. ` +
        `You can view it anytime in your Customer Portal under Communication → Feedback, ` +
        `and it also appears in our public Customer Reviews section at the bottom of our Services page. ` +
        `We truly appreciate your business and value your opinion of our service.`
    );
};

export const buildReviewResponseChatMessage = (review) => {
    const bookingId = review.booking_id;
    return (
        `Thank you for your feedback on Booking #${bookingId}. ` +
        `Our team has added an official response to your review in your Customer Portal under Communication > Feedback. ` +
        `We appreciate your time and your business.`
    );
};

export async function hasReviewApprovalBeenNotified(reviewId, customerId) {
    const { data, error } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('customer_id', customerId)
        .eq('message_context->>action', 'review_approved')
        .eq('message_context->>review_id', String(reviewId))
        .limit(1);

    if (error) {
        console.warn('[reviewNotificationHelper] Could not check prior approval notification:', error);
        return false;
    }
    return (data?.length ?? 0) > 0;
}

export async function sendReviewApprovedChatMessage(review) {
    if (!review?.customer_id) {
        throw new Error('Customer ID is required to send review approval notification.');
    }

    const alreadyNotified = await hasReviewApprovalBeenNotified(review.id, review.customer_id);
    if (alreadyNotified) {
        return;
    }

    const { error } = await supabase.from('chat_messages').insert({
        conversation_id: `cust_${review.customer_id}`,
        customer_id: review.customer_id,
        booking_id: review.booking_id,
        sender_type: 'admin',
        message_content: buildReviewApprovedChatMessage(review),
        is_read: false,
        message_severity: 'success',
        message_context: {
            action: 'review_approved',
            review_id: review.id,
            booking_id: review.booking_id,
        },
    });

    if (error) throw error;
}

export async function sendReviewResponseChatMessage(review) {
    if (!review?.customer_id) {
        throw new Error('Customer ID is required to send a review response notification.');
    }

    const { error } = await supabase.from('chat_messages').insert({
        conversation_id: `cust_${review.customer_id}`,
        customer_id: review.customer_id,
        booking_id: review.booking_id,
        sender_type: 'admin',
        message_content: buildReviewResponseChatMessage(review),
        is_read: false,
        message_severity: 'info',
        message_context: {
            action: 'review_response_added',
            review_id: review.id,
            booking_id: review.booking_id,
        },
    });

    if (error) throw error;
}
