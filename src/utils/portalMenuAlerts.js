import { bookingNeedsSkippedVerification } from './verificationDeadline.js';
import { getUnreviewedBookings } from './reviewEligibility.js';

const TICKET_NOTE_SOURCE = 'Support Ticket';

export function isUnreadAdminChat(message) {
  return Boolean(message) && message.sender_type === 'admin' && message.is_read !== true;
}

export function isUnreadTicketReply(note) {
  return Boolean(note)
    && note.author_type === 'admin'
    && note.is_read !== true
    && note.source === TICKET_NOTE_SOURCE;
}

function customerOwesPayment(booking) {
  if (!booking || booking.status !== 'pending_payment') return false;
  const details = booking.payment_delta_details;
  return Boolean(details) && (Number(details.amount_due) > 0 || details.state === 'pending');
}

function customerOwesVerification(bookings, customer) {
  if (customer?.has_incomplete_verification) return true;
  return (bookings || []).some(
    (booking) => booking.pending_address_verification || bookingNeedsSkippedVerification(booking, customer),
  );
}

/**
 * Menu dots for work the customer still has to finish or look at.
 * A submitted review that is waiting to be published does not count.
 * Opening Direct Chat or Support Tickets clears that section immediately.
 */
export function getPortalMenuAlerts({
  bookings = [],
  customer = null,
  customerReviews = [],
  notes = [],
  chatMessages = [],
  messagesTabOpen = false,
  openSection = null,
} = {}) {
  const chatSeen = messagesTabOpen && openSection === 'chat';
  const ticketsSeen = messagesTabOpen && openSection === 'tickets';

  const showChat = (chatMessages || []).some(isUnreadAdminChat) && !chatSeen;
  const showTickets = (notes || []).some(isUnreadTicketReply) && !ticketsSeen;
  const showReviews = getUnreviewedBookings(bookings, customerReviews).length > 0;

  const verification = customerOwesVerification(bookings, customer);
  const bookingsAlert = (bookings || []).some(customerOwesPayment);
  const messages = showChat || showTickets || showReviews;
  const dashboard = verification || bookingsAlert || messages;

  return {
    dashboard,
    bookings: bookingsAlert,
    verification,
    messages,
    sections: {
      chat: showChat,
      reviews: showReviews,
      tickets: showTickets,
    },
    any: dashboard,
  };
}
