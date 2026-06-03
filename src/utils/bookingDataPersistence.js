
import { supabase } from '@/lib/customSupabaseClient';
import {
  fetchServiceById,
  getServiceIdFromBooking,
  resolveServiceIdForBooking,
} from '@/utils/servicePlan';

function serializeDateForRpc(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDateMatch) return isoDateMatch[1];

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}

function sanitizeNumericForRpc(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/[$,]/g, '')
    .replace(/\s+/g, '');
  if (!normalized) return null;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeIntegerForRpc(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!/^-?\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * EMAIL DEDUPLICATION PATTERN
 * ===========================
 * Pending customer records are written via the store_pending_booking RPC
 * (SECURITY DEFINER) so anon clients never need direct table access.
 */

/**
 * Stores or updates a pending booking in the database with email deduplication
 * @param {Object} bookingData - Contact and booking information
 * @param {Object} plan - Selected service (live row from services)
 * @param {Object} addonsData - Selected add-ons and additional data
 * @param {Object} options - Additional options including pricing data
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
export async function storePendingBooking(bookingData, plan, addonsData, options = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [storePendingBooking] Starting with email: ${bookingData.email}`);

  try {
    const email = bookingData.email?.trim().toLowerCase();
    const runId = `run-${Date.now()}`;

    // #region agent log
    fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H1',location:'bookingDataPersistence.js:storePendingBooking:start',message:'storePendingBooking invoked',data:{emailPresent:Boolean(email),planId:plan?.id,deliveryService:Boolean(options?.deliveryService),dropOffDateType:typeof bookingData?.dropOffDate,pickupDateType:typeof bookingData?.pickupDate},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (!email) {
      console.error(`[${timestamp}] [storePendingBooking] No email provided`);
      return {
        success: false,
        error: 'Email address is required'
      };
    }

    const deliveryService = options.deliveryService || false;
    const resolvedServiceId = resolveServiceIdForBooking(plan, deliveryService) ?? plan?.id ?? null;
    const serviceId = sanitizeIntegerForRpc(resolvedServiceId);
    const dropOffDate = serializeDateForRpc(bookingData.dropOffDate);
    const pickupDate = serializeDateForRpc(bookingData.pickupDate);
    const totalPrice = sanitizeNumericForRpc(options.totalPrice);
    const basePrice = sanitizeNumericForRpc(options.basePrice);

    const agreementFeeSnapshot = Array.isArray(options.agreementFeeSnapshot)
      ? options.agreementFeeSnapshot
      : [];
    const addonsWithFeeSnapshot = agreementFeeSnapshot.length
      ? { ...addonsData, agreementFeeSnapshot }
      : addonsData;

    const payload = {
      email,
      first_name: bookingData.firstName?.trim() || null,
      last_name: bookingData.lastName?.trim() || null,
      name: `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim() || null,
      phone: bookingData.phone?.replace(/\D/g, '') || null,
      street: bookingData.contactAddress?.street || null,
      city: bookingData.contactAddress?.city || null,
      state: bookingData.contactAddress?.state || null,
      zip: bookingData.contactAddress?.zip || null,
      contact_address: bookingData.contactAddress || null,
      delivery_address: addonsData?.deliveryAddress || bookingData.contactAddress || null,
      drop_off_date: dropOffDate,
      pickup_date: pickupDate,
      drop_off_time_slot: bookingData.dropOffTimeSlot || null,
      pickup_time_slot: bookingData.pickupTimeSlot || null,
      notes: bookingData.notes || null,
      service_id: serviceId,
      plan_data: null,
      addons_data: addonsWithFeeSnapshot || null,
      booking_data: {
        ...(bookingData || {}),
        agreementAcceptedAt: new Date().toISOString(),
      },
      total_price: totalPrice,
      base_price: basePrice,
      delivery_service: deliveryService
    };

    const { data: existingRows, error: existingRowsError } = await supabase
      .from('pending_customers')
      .select('id, email, is_verified')
      .ilike('email', email);

    // #region agent log
    fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H2',location:'bookingDataPersistence.js:storePendingBooking:preflight',message:'preflight pending_customers lookup before RPC',data:{email,preflightErrorCode:existingRowsError?.code||null,preflightCount:Array.isArray(existingRows)?existingRows.length:null,preflightIds:Array.isArray(existingRows)?existingRows.map((r)=>r.id):[]},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const { data: token, error } = await supabase.rpc('store_pending_booking', { payload });

    if (error) {
      const rpcReason = [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(' | ');
      const payloadDiagnostic = {
        service_id: payload.service_id,
        service_id_type: typeof payload.service_id,
        drop_off_date: payload.drop_off_date,
        pickup_date: payload.pickup_date,
        total_price: payload.total_price,
        total_price_type: typeof payload.total_price,
        base_price: payload.base_price,
        base_price_type: typeof payload.base_price,
        email_present: Boolean(payload.email),
      };
      console.error(
        `[${timestamp}] [storePendingBooking] RPC error:`,
        rpcReason || error,
        payloadDiagnostic,
        error
      );
      // #region agent log
      fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H3',location:'bookingDataPersistence.js:storePendingBooking:rpcError',message:'store_pending_booking RPC failed',data:{errorCode:error.code||null,errorMessage:error.message||null,errorDetails:error.details||null,httpStatus:error?.code==='23505'?'conflict':null,payloadDiagnostic},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return {
        success: false,
        error: 'Failed to save booking information. Please try again.'
      };
    }

    if (!token) {
      return {
        success: false,
        error: 'Failed to save booking information. Please try again.'
      };
    }

    console.log(`[${timestamp}] [storePendingBooking] ✓ Saved pending booking:`, token);
    // #region agent log
    fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H4',location:'bookingDataPersistence.js:storePendingBooking:success',message:'store_pending_booking RPC succeeded',data:{tokenPresent:Boolean(token),tokenType:typeof token},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    return {
      success: true,
      token
    };
  } catch (error) {
    const catchTs = new Date().toISOString();
    console.error(`[${catchTs}] [storePendingBooking] Unexpected error:`, error);
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again.'
    };
  }
}

/**
 * Load live service for a pending row (service_id preferred; legacy plan_data fallback).
 * @param {Object} pending
 * @returns {Promise<object|null>}
 */
export async function hydratePlanFromPending(pending) {
  const serviceId = getServiceIdFromBooking(pending);
  if (serviceId) {
    const { data, error } = await fetchServiceById(supabase, serviceId);
    if (!error && data) return data;
  }
  const legacy = pending?.plan_data;
  if (legacy && Object.keys(legacy).length > 0) return legacy;
  return null;
}

/**
 * Maps a pending_customers row into BookingJourney state shape.
 * @param {Object} pending - Row from pending_customers
 * @param {Object|null} [hydratedPlan] - Live service from hydratePlanFromPending
 */
export function mapPendingToBookingState(pending, hydratedPlan = null) {
  const plan = hydratedPlan || pending.plan_data || {};
  const addons = pending.addons_data || {};
  const deliveryService = pending.delivery_service ?? false;
  const requiresDriverVerification = Boolean(
    plan?.customer_pickup && !deliveryService
  ) || (Number(plan?.id) === 2 && !deliveryService);

  return {
    contactInfo: {
      firstName: pending.first_name || '',
      lastName: pending.last_name || '',
      email: pending.email || '',
      phone: pending.phone || '',
      contactAddress: pending.contact_address || {
        street: pending.street,
        city: pending.city,
        state: pending.state,
        zip: pending.zip
      },
      dropOffDate: pending.drop_off_date,
      pickupDate: pending.pickup_date,
      dropOffTimeSlot: pending.drop_off_time_slot,
      pickupTimeSlot: pending.pickup_time_slot,
      notes: pending.notes || ''
    },
    selectedPlan: plan,
    addonsData: {
      insurance: addons.insurance || 'accept',
      drivewayProtection: addons.drivewayProtection || 'decline',
      equipment: addons.equipment || [],
      coupon: addons.coupon || null,
      deliveryAddress: addons.deliveryAddress || null,
      deliveryDistance: addons.deliveryDistance || 0,
      deliveryFee: addons.deliveryFee || 0,
      ...addons,
    },
    basePrice: pending.base_price || 0,
    finalPrice: pending.total_price || 0,
    deliveryService,
    requiresDriverVerification,
  };
}

/**
 * Retrieves a pending booking by token (UUID)
 * @param {string} token - The pending_customers UUID
 * @returns {Promise<{success: boolean, bookingData?: Object, error?: string}>}
 */
export async function retrievePendingBooking(token) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [retrievePendingBooking] Fetching token: ${token}`);

  try {
    if (!token) {
      return {
        success: false,
        error: 'No booking reference provided'
      };
    }

    const { data, error } = await supabase.rpc('get_pending_customer_by_id', { p_id: token });

    if (error) {
      console.error(`[${timestamp}] [retrievePendingBooking] Query error:`, error);
      return {
        success: false,
        error: 'Could not find your booking. The link may have expired.'
      };
    }

    const record = Array.isArray(data) ? data[0] : data;

    if (!record) {
      console.warn(`[${timestamp}] [retrievePendingBooking] No record found for token`);
      return {
        success: false,
        error: 'Booking not found. Please start a new booking.'
      };
    }

    console.log(`[${timestamp}] [retrievePendingBooking] ✓ Successfully retrieved record`);

    return {
      success: true,
      bookingData: record
    };
  } catch (error) {
    console.error(`[${timestamp}] [retrievePendingBooking] Unexpected error:`, error);
    return {
      success: false,
      error: 'Failed to retrieve booking information.'
    };
  }
}

/**
 * Marks a pending customer as verified (handled by verify-email-code edge function in production).
 * @deprecated Prefer the verify-email-code edge function.
 */
export async function markPendingCustomerVerified(email) {
  console.warn('[markPendingCustomerVerified] Direct table updates are disabled; use verify-email-code edge function.');
  return {
    success: false,
    error: 'Verification must be completed via the email verification flow.'
  };
}
