import { getCorsHeaders } from './cors.ts';
import { jsonError, jsonOk, serviceRoleClient, sha256Hex } from '../_shared/phoneOrderAuth.ts';
import { priceReviewFromBooking } from '../_shared/customerPriceReview.ts';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

function stripeClient() {
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!key) throw new Error('Stripe is not configured on the server.');
  return new Stripe(key, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function appointmentInsideLead(booking: Record<string, unknown> | null) {
  const date = String(booking?.drop_off_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(year, month - 1, day, 0, 0, 0, 0);
  const time = String(booking?.drop_off_time_slot || '').trim();
  const ampm = time.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const clock = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'pm') hour += 12;
    at.setHours(hour, Number(ampm[2]), 0, 0);
  } else if (clock) {
    at.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] || 0), 0);
  }
  return Date.now() >= at.getTime() - 12 * 60 * 60 * 1000;
}

function summaryFrom(order: Record<string, unknown>, booking: Record<string, unknown> | null) {
  const addons = (booking?.addons as Record<string, unknown>) || {};
  const plan = (booking?.plan as Record<string, unknown>) || {};
  const serviceName = String(order.service_name || plan.name || 'Rental');
  const priceReview = priceReviewFromBooking(booking, serviceName) as Record<string, unknown>;
  return {
    phoneOrderId: order.id,
    status: order.status,
    expiresAt: order.link_expires_at,
    paymentChoice: order.payment_choice,
    customerName: order.customer_name,
    firstName: booking?.first_name || '',
    lastName: booking?.last_name || '',
    email: order.customer_email,
    phone: order.customer_phone,
    serviceName,
    total: booking?.total_price ?? order.total_price,
    subtotal: booking?.subtotal_before_tax ?? null,
    tax: booking?.tax_amount ?? null,
    taxRate: priceReview.taxRate ?? booking?.tax_rate_used ?? null,
    rentalDays: priceReview.days ?? null,
    promoLabel: priceReview.promoLabel || plan.promo_label || '',
    priceReview,
    dropOff: booking?.drop_off_date || null,
    pickup: booking?.pickup_date || null,
    dropOffTime: booking?.drop_off_time_slot || null,
    pickupTime: booking?.pickup_time_slot || null,
    street: booking?.street || null,
    city: booking?.city || null,
    state: booking?.state || null,
    zip: booking?.zip || null,
    notes: booking?.notes || null,
    bookingId: order.booking_id,
    pendingId: order.pending_customer_id,
    customerId: booking?.customer_id || null,
    pickupRequired: addons.isDelivery !== true && order.verification_skipped !== true && addons.customerPickup === true,
    documentsRequiredNow: appointmentInsideLead(booking),
    verificationSkipped: order.verification_skipped === true,
    lineItems: Array.isArray(addons.taxLineItemsSnapshot) ? addons.taxLineItemsSnapshot : [],
  };
}

function normalizePlate(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
}

function plateIsValid(value: string) {
  return /^[A-Z0-9]{6,7}$/.test(value);
}

async function loadStoredVerification(supabase: ReturnType<typeof serviceRoleClient>, customerId: unknown) {
  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return { plate: '', filesComplete: false };
  const [{ data: customer }, { data: docs }] = await Promise.all([
    supabase.from('customers').select('license_plate').eq('id', id).maybeSingle(),
    supabase.from('driver_verification_documents').select('license_front_url, license_front_storage_path, license_back_url, license_back_storage_path, insurance_url, insurance_storage_path').eq('customer_id', id).maybeSingle(),
  ]);
  const plate = normalizePlate(customer?.license_plate);
  const filesComplete = Boolean(
    (docs?.license_front_url || docs?.license_front_storage_path)
    && (docs?.license_back_url || docs?.license_back_storage_path)
    && (docs?.insurance_url || docs?.insurance_storage_path),
  );
  return { plate, filesComplete };
}

async function loadByToken(supabase: ReturnType<typeof serviceRoleClient>, token: string) {
  const tokenHash = await sha256Hex(token);
  const { data: link, error } = await supabase
    .from('phone_order_links')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!link) return { error: 'This confirmation link is not valid.', status: 404 };
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return { error: 'This confirmation link has expired. Ask us to send a new one.', status: 410 };
  }
  const { data: order, error: orderError } = await supabase.from('phone_orders').select('*').eq('id', link.phone_order_id).single();
  if (orderError || !order) return { error: 'This order could not be found.', status: 404 };
  if (order.link_expires_at && new Date(order.link_expires_at).getTime() < Date.now()) {
    return { error: 'This confirmation link has expired. Ask us to send a new one.', status: 410 };
  }
  let booking = null;
  if (order.booking_id) {
    const { data } = await supabase.from('bookings').select('*').eq('id', order.booking_id).maybeSingle();
    booking = data;
  }
  return { link, order, booking };
}

async function markEmailVerified(supabase: ReturnType<typeof serviceRoleClient>, email: string, pendingId: string | null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  const { data: existing } = await supabase
    .from('email_verifications')
    .select('email')
    .ilike('email', normalized)
    .limit(1)
    .maybeSingle();
  if (existing?.email) {
    await supabase.from('email_verifications').update({ is_verified: true }).eq('email', existing.email);
  } else {
    await supabase.from('email_verifications').insert({
      email: normalized,
      verification_code: 'phone-order',
      code_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      is_verified: true,
    });
  }
  if (pendingId) {
    await supabase.from('pending_customers').update({
      is_verified: true,
      verified_at: new Date().toISOString(),
    }).eq('id', pendingId);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const token = String(body.token || '').trim();
    const action = String(body.action || 'open');
    if (!token) return jsonError(corsHeaders, 'Missing confirmation token.', 400);

    const supabase = serviceRoleClient();
    const loaded = await loadByToken(supabase, token);
    if (loaded.error) return jsonError(corsHeaders, loaded.error, loaded.status || 400);
    const { link, order, booking } = loaded;

    if (order.status === 'accepted') {
      const stillUnpaid = order.payment_choice === 'customer_link'
        && String(booking?.status || '') === 'pending_payment';
      return jsonOk(corsHeaders, {
        alreadyAccepted: !stillUnpaid,
        summary: summaryFrom(order, booking),
        redirect: stillUnpaid
          ? `/payment?bookingId=${order.pending_customer_id}`
          : (order.booking_id ? `/confirmation?booking_id=${order.booking_id}` : null),
      });
    }
    if (order.status === 'expired' || order.status === 'cancelled') {
      return jsonError(corsHeaders, 'This phone order is no longer open.', 410);
    }

    if (!link.opened_at) {
      await supabase.from('phone_order_links').update({ opened_at: new Date().toISOString() }).eq('id', link.id);
    }

    if (action === 'open') {
      if (link.channel === 'email' || link.channel === 'both') {
        await markEmailVerified(supabase, order.customer_email, null);
      }
      const stored = await loadStoredVerification(supabase, booking?.customer_id);
      return jsonOk(corsHeaders, {
        summary: {
          ...summaryFrom(order, booking),
          savedLicensePlate: plateIsValid(stored.plate) ? stored.plate : '',
          documentsOnFile: stored.filesComplete && plateIsValid(stored.plate),
        },
      });
    }

    if (action !== 'accept') return jsonError(corsHeaders, 'Unknown action.', 400);

    const typedName = String(body.signatureName || '').trim().replace(/\s+/g, ' ');
    const expected = `${booking?.first_name || ''} ${booking?.last_name || ''}`.trim().replace(/\s+/g, ' ');
    if (!typedName || typedName.toLowerCase() !== expected.toLowerCase()) {
      return jsonError(corsHeaders, 'Type your full name exactly as it appears on the booking.', 400);
    }
    if (body.termsAccepted !== true || body.summaryAccepted !== true) {
      return jsonError(corsHeaders, 'The terms and the booking summary both need to be accepted.', 400);
    }

    const pickupRequired = summaryFrom(order, booking).pickupRequired;
    const documentsRequiredNow = appointmentInsideLead(booking);
    const deferDocuments = body.deferDocuments === true;
    const stored = await loadStoredVerification(supabase, booking?.customer_id);
    const requestedPlate = normalizePlate(body.licensePlate);
    const plate = plateIsValid(requestedPlate) ? requestedPlate : stored.plate;
    const plateValid = plateIsValid(plate);
    const filesAlreadyStored = stored.filesComplete;
    const documentsMarkedComplete = body.documentsComplete === true || body.documentsComplete === 'true' || filesAlreadyStored;
    if (pickupRequired) {
      if (documentsRequiredNow && deferDocuments) {
        return jsonError(corsHeaders, 'This pickup is inside 12 hours. The license, insurance, and plate have to be added on this link before the booking can continue.', 400);
      }
      if (!deferDocuments && (!documentsMarkedComplete || !plateValid)) {
        console.log(`[phone-order-acceptance] blocked booking=${booking?.id} flag=${body.documentsComplete} plateLen=${requestedPlate.length} storedFiles=${filesAlreadyStored} storedPlateLen=${stored.plate.length}`);
        return jsonError(corsHeaders, documentsRequiredNow
          ? 'This pickup is inside 12 hours. Add a 6 or 7 character license plate, both sides of the license, and proof of insurance before continuing.'
          : 'Enter a license plate of 6 or 7 letters and numbers plus both sides of the license and proof of insurance, or agree to add them in the customer portal at least 12 hours before pickup.', 400);
      }
    }
    const verificationSkipped = pickupRequired && deferDocuments && !documentsRequiredNow;

    const smsTransactionalOptIn = body.smsTransactionalOptIn === true;
    const smsMarketingOptIn = body.smsMarketingOptIn === true;
    const signatureDate = String(body.signatureDate || '').trim() || new Date().toISOString().slice(0, 10);

    const addons = {
      ...((booking?.addons as Record<string, unknown>) || {}),
      orderChannel: 'phone',
      termsAccepted: true,
      agreementSignature: typedName,
      agreementSignatureDate: signatureDate,
      agreementAcceptedAt: new Date().toISOString(),
      wasVerificationSkipped: verificationSkipped,
      verificationSkipped,
      verificationNotes: verificationSkipped
        ? 'Customer agreed to add the license plate, both sides of the driver license, and proof of insurance in the customer portal at least 12 hours before pickup.'
        : null,
      licensePlate: plateValid ? plate : null,
      smsTransactionalOptIn,
      smsMarketingOptIn,
    };

    if (booking?.id) {
      await supabase.from('bookings').update({
        addons,
        was_verification_skipped: verificationSkipped,
        verification_notes: verificationSkipped
          ? 'Customer agreed to add the license plate, both sides of the driver license, and proof of insurance in the customer portal at least 12 hours before pickup.'
          : null,
      }).eq('id', booking.id);
    }

    if (order.pending_customer_id) {
      const { data: pending } = await supabase.from('pending_customers').select('addons_data,booking_data').eq('id', order.pending_customer_id).maybeSingle();
      await supabase.from('pending_customers').update({
        is_verified: true,
        verified_at: new Date().toISOString(),
        addons_data: { ...((pending?.addons_data as Record<string, unknown>) || {}), ...addons },
        booking_data: {
          ...((pending?.booking_data as Record<string, unknown>) || {}),
          termsAccepted: true,
          smsTransactionalOptIn,
          smsMarketingOptIn,
        },
      }).eq('id', order.pending_customer_id);
    }

    if (booking?.customer_id) {
      await supabase.from('customers').update({
        sms_opt_in: smsTransactionalOptIn,
        sms_marketing_opt_in: smsMarketingOptIn,
        ...(verificationSkipped ? { has_incomplete_verification: true } : {}),
      }).eq('id', booking.customer_id);
    }

    await markEmailVerified(supabase, order.customer_email, order.pending_customer_id);

    if (order.payment_choice === 'customer_link') {
      await supabase.from('phone_orders').update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      return jsonOk(corsHeaders, {
        ok: true,
        redirect: `/payment?bookingId=${order.pending_customer_id}`,
      });
    }

    const paymentIntentId = booking?.payment_intent;
    if (!paymentIntentId) {
      return jsonError(corsHeaders, 'A card has not been authorized for this order yet.', 400);
    }
    const stripe = stripeClient();
    const existing = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    if (existing.status === 'requires_capture') {
      await stripe.paymentIntents.capture(String(paymentIntentId));
    } else if (existing.status !== 'succeeded') {
      return jsonError(corsHeaders, `The card authorization is not ready (${existing.status}).`, 400);
    }

    const finalizeResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/finalize-booking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        bookingId: booking.id,
        paymentIntentId,
        site_url: body.siteUrl || null,
      }),
    });
    const finalizeBody = await finalizeResponse.json().catch(() => ({}));
    if (!finalizeResponse.ok || finalizeBody.success === false) {
      return jsonError(corsHeaders, finalizeBody.error || 'The booking could not be finished after payment.', 400);
    }

    await supabase.from('phone_orders').update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);

    return jsonOk(corsHeaders, {
      ok: true,
      redirect: `/confirmation?booking_id=${booking.id}&payment_intent=${paymentIntentId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not open this confirmation.';
    console.error('[phone-order-acceptance]', message);
    return jsonError(corsHeaders, message, 400);
  }
});
