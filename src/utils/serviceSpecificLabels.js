
/**
 * Service-Specific Label Utility
 * Returns the correct date/time labels based on service type
 * 
 * ONLY the self-service Dump Loader Trailer Rental uses "Pickup Date" and "Return Date"
 * All other services use original labels ("Drop-off", "Pickup", "Delivery", etc.)
 */

/**
 * Determine if a service is self-service Dump Loader Trailer
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @returns {boolean} True if self-service trailer
 */
export function isSelfServiceTrailer(plan, isDelivery = false) {
  if (!plan) return false;
  // Self-service trailer: plan ID 2 WITHOUT delivery
  return plan.id === 2 && !isDelivery;
}

/**
 * Get the appropriate label for drop-off/pickup date
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @param {string} labelType - Type of label: 'dropoff' or 'pickup'
 * @returns {string} The appropriate label
 */
export function getServiceSpecificDateLabel(plan, isDelivery, labelType) {
  const isSelfService = isSelfServiceTrailer(plan, isDelivery);
  
  if (labelType === 'dropoff') {
    // Self-service trailer: "Pickup Date"
    // Delivery services: "Delivery Drop-off" or "Delivery"
    // Standard services: "Drop-off"
    if (isSelfService) {
      return 'Pickup Date';
    }
    if (isDelivery || plan?.id === 1 || plan?.id === 4) {
      return 'Delivery Drop-off';
    }
    return 'Drop-off';
  }
  
  if (labelType === 'pickup') {
    // Self-service trailer: "Return Date"
    // Delivery services: "Delivery Pickup"
    // Standard services: "Pickup"
    if (isSelfService) {
      return 'Return Date';
    }
    if (isDelivery || plan?.id === 1 || plan?.id === 4) {
      return 'Delivery Pickup';
    }
    return 'Pickup';
  }
  
  return 'Date';
}

/**
 * Get the appropriate label for time slots
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @param {string} labelType - Type of label: 'dropoff' or 'pickup'
 * @returns {string} The appropriate time label
 */
export function getServiceSpecificTimeLabel(plan, isDelivery, labelType) {
  const isSelfService = isSelfServiceTrailer(plan, isDelivery);
  
  if (labelType === 'dropoff') {
    // Self-service trailer: "Pickup Start Time"
    // All other services: just the time (formatted by formatTimeWindow)
    if (isSelfService) {
      return 'Pickup Start Time';
    }
    return '';
  }
  
  if (labelType === 'pickup') {
    // Self-service trailer: "Return by Time"
    // All other services: just the time (formatted by formatTimeWindow)
    if (isSelfService) {
      return 'Return by Time';
    }
    return '';
  }
  
  return '';
}

/**
 * Get full formatted date and time label
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @param {string} labelType - Type of label: 'dropoff' or 'pickup'
 * @param {string} dateStr - Formatted date string
 * @param {string} timeStr - Formatted time string
 * @returns {string} Complete formatted label with date and time
 */
export function getFullDateTimeLabel(plan, isDelivery, labelType, dateStr, timeStr) {
  const isSelfService = isSelfServiceTrailer(plan, isDelivery);
  const dateLabel = getServiceSpecificDateLabel(plan, isDelivery, labelType);
  
  if (isSelfService) {
    // Self-service trailer shows explicit time labels
    const timeLabel = getServiceSpecificTimeLabel(plan, isDelivery, labelType);
    return `${dateLabel}: ${dateStr}\n${timeLabel}: ${timeStr}`;
  }
  
  // All other services show date and time inline
  return `${dateLabel}: ${dateStr} at ${timeStr}`;
}
