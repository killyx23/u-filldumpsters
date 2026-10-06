const REVIEWABLE_STATUSES = ['Completed', 'flagged', 'Returned'];

export function isBookingReviewable(booking) {
  if (!booking) return false;
  return REVIEWABLE_STATUSES.includes(booking.status) || Boolean(booking.returned_at);
}

function toIdSet(reviewsOrIds) {
  const ids = [];
  for (const value of reviewsOrIds || []) {
    if (value == null) continue;
    if (typeof value === 'object') {
      if (value.booking_id != null) ids.push(String(value.booking_id));
    } else {
      ids.push(String(value));
    }
  }
  return new Set(ids);
}

export function isReviewPending(review) {
  return Boolean(review) && review.is_public !== true;
}

export function getPendingReviews(customerReviews) {
  return (customerReviews || []).filter((review) => isReviewPending(review));
}

export const PENDING_REVIEW_MESSAGE =
  'Thank you for your feedback. It is pending currently. You can come back here to see when it has been published.';

export function bookingNeedsReview(booking, reviewedBookingIds) {
  if (!isBookingReviewable(booking)) return false;
  return !toIdSet(reviewedBookingIds).has(String(booking.id));
}

export function getUnreviewedBookings(bookings, reviewedBookingIds) {
  return (bookings || []).filter((booking) => bookingNeedsReview(booking, reviewedBookingIds));
}
