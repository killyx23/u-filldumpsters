const BOOKING_DRAFT_KEY = 'ufill-sms-booking-draft';
const ORDER_ACCEPT_DRAFT_KEY = 'ufill-sms-order-accept-draft';
const PROFILE_DRAFT_KEY = 'ufill-sms-profile-draft';
const RETURN_PENDING_KEY = 'ufill-sms-return-pending';

export function currentReturnPath(location) {
  const path = `${location?.pathname || '/'}${location?.search || ''}`;
  return isSafeReturnPath(path) ? path : '/';
}

export function isSafeReturnPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

export function markSmsReturnPending(path) {
  try {
    if (isSafeReturnPath(path)) sessionStorage.setItem(RETURN_PENDING_KEY, path);
  } catch {
    // ignore storage errors
  }
}

export function peekSmsReturnPending(path) {
  try {
    return sessionStorage.getItem(RETURN_PENDING_KEY) === path;
  } catch {
    return false;
  }
}

export function clearSmsReturnPending() {
  try {
    sessionStorage.removeItem(RETURN_PENDING_KEY);
  } catch {
    // ignore storage errors
  }
}

export function consumeSmsReturnPending(path) {
  try {
    const pending = sessionStorage.getItem(RETURN_PENDING_KEY);
    if (!pending || pending !== path) return false;
    sessionStorage.removeItem(RETURN_PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Draft saved before opening Terms or Privacy, if this visit should return to it. */
export function readDraftForCurrentReturn() {
  if (typeof window === 'undefined') return null;
  const path = `${window.location.pathname}${window.location.search}`;
  const historyState = window.history.state?.usr;
  const shouldRestore = historyState?.resumeDraft === true || peekSmsReturnPending(path);
  if (!shouldRestore) return null;
  return readBookingDraft();
}

function readJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

function reviveDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return value ?? null;
}

export function writeBookingDraft(draft) {
  const bookingData = draft?.bookingData || {};
  writeJson(BOOKING_DRAFT_KEY, {
    currentStep: draft.currentStep,
    highestStep: draft.highestStep,
    showDiyEquipmentSelection: draft.showDiyEquipmentSelection === true,
    selectedPlan: draft.selectedPlan || null,
    addonsData: draft.addonsData || null,
    basePrice: draft.basePrice ?? 0,
    finalPrice: draft.finalPrice ?? 0,
    deliveryService: draft.deliveryService === true,
    agreementFeeSnapshot: Array.isArray(draft.agreementFeeSnapshot) ? draft.agreementFeeSnapshot : [],
    bookingData: {
      ...bookingData,
      dropOffDate: bookingData.dropOffDate instanceof Date
        ? bookingData.dropOffDate.toISOString()
        : bookingData.dropOffDate || null,
      pickupDate: bookingData.pickupDate instanceof Date
        ? bookingData.pickupDate.toISOString()
        : bookingData.pickupDate || null,
    },
  });
}

export function readBookingDraft() {
  const draft = readJson(BOOKING_DRAFT_KEY);
  if (!draft || !draft.bookingData) return null;
  return {
    ...draft,
    bookingData: {
      ...draft.bookingData,
      dropOffDate: reviveDate(draft.bookingData.dropOffDate),
      pickupDate: reviveDate(draft.bookingData.pickupDate),
    },
  };
}

export function clearBookingDraft() {
  try {
    sessionStorage.removeItem(BOOKING_DRAFT_KEY);
    sessionStorage.removeItem(RETURN_PENDING_KEY);
  } catch {
    // ignore storage errors
  }
}

export function writeOrderAcceptDraft(token, draft) {
  if (!token) return;
  writeJson(ORDER_ACCEPT_DRAFT_KEY, {
    token,
    scrolled: draft.scrolled === true,
    summaryAccepted: draft.summaryAccepted === true,
    termsAccepted: draft.termsAccepted === true,
    signatureName: draft.signatureName || '',
    signatureDate: draft.signatureDate || '',
    orderTexts: draft.orderTexts === true,
    marketingTexts: draft.marketingTexts === true,
    policiesAccepted: draft.policiesAccepted === true,
    licensePlate: draft.licensePlate || '',
    deferDocuments: draft.deferDocuments === true,
  });
}

export function readOrderAcceptDraft(token) {
  const draft = readJson(ORDER_ACCEPT_DRAFT_KEY);
  if (!draft || draft.token !== token) return null;
  return draft;
}

export function clearOrderAcceptDraft() {
  try {
    sessionStorage.removeItem(ORDER_ACCEPT_DRAFT_KEY);
  } catch {
    // ignore storage errors
  }
}

export function writeProfileDraft(customerId, draft) {
  if (!customerId) return;
  writeJson(PROFILE_DRAFT_KEY, {
    customerId,
    policiesAccepted: draft.policiesAccepted === true,
    formData: draft.formData || null,
  });
}

export function readProfileDraft(customerId) {
  const draft = readJson(PROFILE_DRAFT_KEY);
  if (!draft || draft.customerId !== customerId || !draft.formData) return null;
  return draft;
}

export function clearProfileDraft() {
  try {
    sessionStorage.removeItem(PROFILE_DRAFT_KEY);
  } catch {
    // ignore storage errors
  }
}
