import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPortalMenuAlerts } from './portalMenuAlerts.js';

const completed = { id: 1, status: 'Completed' };

test('an unread admin note that is not a ticket does not light Communication', () => {
  const alerts = getPortalMenuAlerts({
    notes: [{ id: 9, author_type: 'admin', is_read: false, source: 'Address Verification' }],
    chatMessages: [],
  });
  assert.equal(alerts.messages, false);
  assert.equal(alerts.sections.chat, false);
  assert.equal(alerts.sections.tickets, false);
});

test('unread support chat lights Communication until Direct Chat is open', () => {
  const chatMessages = [{ id: 'm1', sender_type: 'admin', is_read: false }];
  const closed = getPortalMenuAlerts({ chatMessages });
  assert.equal(closed.messages, true);
  assert.equal(closed.sections.chat, true);
  assert.equal(closed.dashboard, true);

  const open = getPortalMenuAlerts({
    chatMessages,
    messagesTabOpen: true,
    openSection: 'chat',
  });
  assert.equal(open.sections.chat, false);
  assert.equal(open.messages, false);
});

test('a rental still needing a review keeps Feedback on after chat is opened', () => {
  const alerts = getPortalMenuAlerts({
    bookings: [completed],
    customerReviews: [],
    chatMessages: [{ id: 'm1', sender_type: 'admin', is_read: false }],
    messagesTabOpen: true,
    openSection: 'chat',
  });
  assert.equal(alerts.sections.chat, false);
  assert.equal(alerts.sections.reviews, true);
  assert.equal(alerts.messages, true);
});

test('a submitted review does not keep a menu dot while it waits to be published', () => {
  const alerts = getPortalMenuAlerts({
    bookings: [completed],
    customerReviews: [{ id: 4, booking_id: 1, is_public: false }],
  });
  assert.equal(alerts.sections.reviews, false);
  assert.equal(alerts.messages, false);
  assert.equal(alerts.dashboard, false);
});

test('opening Support Tickets clears an unread ticket reply', () => {
  const notes = [{ id: 3, author_type: 'admin', is_read: false, source: 'Support Ticket' }];
  const closed = getPortalMenuAlerts({ notes });
  assert.equal(closed.sections.tickets, true);
  const open = getPortalMenuAlerts({ notes, messagesTabOpen: true, openSection: 'tickets' });
  assert.equal(open.sections.tickets, false);
  assert.equal(open.messages, false);
});

test('verification and payment dots follow the customer job and light the dashboard', () => {
  const verification = getPortalMenuAlerts({
    bookings: [{ id: 2, pending_address_verification: true, status: 'Confirmed' }],
  });
  assert.equal(verification.verification, true);
  assert.equal(verification.dashboard, true);
  assert.equal(verification.messages, false);

  const payment = getPortalMenuAlerts({
    bookings: [{
      id: 3,
      status: 'pending_payment',
      payment_delta_details: { amount_due: 20, state: 'pending' },
    }],
  });
  assert.equal(payment.bookings, true);
  assert.equal(payment.dashboard, true);

  const staffReview = getPortalMenuAlerts({
    customer: { has_incomplete_verification: false },
    bookings: [{ id: 4, status: 'pending_review', pending_address_verification: false }],
  });
  assert.equal(staffReview.verification, false);
  assert.equal(staffReview.any, false);
});
