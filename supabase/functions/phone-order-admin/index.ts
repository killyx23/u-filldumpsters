import { getCorsHeaders } from './cors.ts';
import { jsonError, jsonOk, requireAdminCaller, serviceRoleClient, sha256Hex } from '../_shared/phoneOrderAuth.ts';
import { sendEmail, sendSms } from '../_shared/notify.ts';
import { resolvePublicSiteUrl } from '../_shared/normalizeSiteUrl.ts';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

const LINK_HOURS = 4;

function stripeClient() {
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!key) throw new Error('Stripe is not configured on the server.');
  return new Stripe(key, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function holdItems(addons: Record<string, unknown> | null) {
  const equipment = addons?.equipment;
  if (!Array.isArray(equipment)) return [];
  return equipment
    .map((item) => {
      const row = item as Record<string, unknown>;
      const equipmentId = Number(row.dbId || row.equipment_id || row.id);
      const quantity = Number(row.quantity || 1);
      if (!Number.isFinite(equipmentId) || equipmentId <= 0) return null;
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      return { equipment_id: equipmentId, quantity };
    })
    .filter(Boolean);
}

function emailHtml(name: string, url: string, summary: string) {
  return `<!DOCTYPE html>
<html><body style="margin:0;background:#0f172a;color:#f8fafc;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="letter-spacing:.18em;text-transform:uppercase;color:#eab308;font-size:12px;font-family:Arial,sans-serif;">U-Fill Dumpsters</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 12px;">Confirm your booking</h1>
    <p style="line-height:1.5;color:#e2e8f0;">${name}, your phone order is ready. Open this link to review the terms and confirm.</p>
    <p style="line-height:1.5;color:#cbd5e1;">${summary}</p>
    <p style="margin:28px 0;"><a href="${url}" style="background:#eab308;color:#111827;text-decoration:none;padding:14px 22px;border-radius:999px;font-family:Arial,sans-serif;font-weight:700;">Review and confirm</a></p>
    <p style="font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;">This link expires in 4 hours. If you did not request this order, you can ignore this email.</p>
  </div>
</body></html>`;
}

async function releaseHold(supabase: ReturnType<typeof serviceRoleClient>, booking: Record<string, unknown>) {
  const items = holdItems((booking.addons as Record<string, unknown>) || null);
  if (items.length > 0 && booking.addons && (booking.addons as Record<string, unknown>).equipment_hold_active !== false) {
    await supabase.rpc('increment_equipment_quantities', { items_to_increment: items });
  }
  const addons = {
    ...((booking.addons as Record<string, unknown>) || {}),
    equipment_hold_active: false,
  };
  await supabase.from('bookings').update({
    status: 'booking_not_finished',
    addons,
    notes: 'Phone order link expired before the customer confirmed.',
  }).eq('id', booking.id).eq('status', 'pending_payment');
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const adminAuth = await requireAdminCaller(req, corsHeaders);
    if (adminAuth.error) return adminAuth.error;

    const body = await req.json();
    const action = String(body.action || '');
    const supabase = serviceRoleClient();

    if (action === 'lookup') {
      const email = String(body.email || '').trim().toLowerCase();
      const phoneDigits = String(body.phone || '').replace(/\D/g, '');
      const dropOff = body.dropOff || null;
      const pickup = body.pickup || null;

      const customers = [];
      const seen = new Set();
      const addCustomers = (rows) => {
        for (const row of rows || []) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          customers.push(row);
        }
      };
      if (email) {
        const safeEmail = email.replace(/[%_,]/g, '');
        const { data, error } = await supabase
          .from('customers')
          .select('id,name,first_name,last_name,email,phone,street,city,state,zip')
          .ilike('email', safeEmail)
          .limit(8);
        if (error) throw error;
        addCustomers(data);
      }
      if (phoneDigits.length >= 7) {
        const { data, error } = await supabase
          .from('customers')
          .select('id,name,first_name,last_name,email,phone,street,city,state,zip')
          .ilike('phone', `%${phoneDigits.slice(-10)}%`)
          .limit(8);
        if (error) throw error;
        addCustomers(data);
      }

      const overlapping = [];
      const seenBookings = new Set();
      const addBookings = (rows) => {
        for (const row of rows || []) {
          if (seenBookings.has(row.id)) continue;
          const status = String(row.status || '').toLowerCase();
          if (['cancelled', 'canceled', 'booking_not_finished'].includes(status)) continue;
          if (dropOff && pickup && row.drop_off_date && row.pickup_date) {
            const overlaps = String(row.drop_off_date) <= String(pickup) && String(row.pickup_date) >= String(dropOff);
            if (!overlaps) continue;
          }
          seenBookings.add(row.id);
          overlapping.push(row);
        }
      };
      if (email) {
        const { data, error } = await supabase
          .from('bookings')
          .select('id,status,email,phone,name,drop_off_date,pickup_date,total_price')
          .ilike('email', email)
          .order('drop_off_date', { ascending: false })
          .limit(20);
        if (error) throw error;
        addBookings(data);
      }
      if (phoneDigits.length >= 7) {
        const { data, error } = await supabase
          .from('bookings')
          .select('id,status,email,phone,name,drop_off_date,pickup_date,total_price')
          .ilike('phone', `%${phoneDigits.slice(-10)}%`)
          .order('drop_off_date', { ascending: false })
          .limit(20);
        if (error) throw error;
        addBookings(data);
      }

      let openPending: unknown[] = [];
      if (email) {
        const { data, error } = await supabase
          .from('pending_customers')
          .select('id,email,created_at,booking_id,total_price')
          .ilike('email', email)
          .order('created_at', { ascending: false })
          .limit(3);
        if (error) throw error;
        openPending = data || [];
      }

      return jsonOk(corsHeaders, { customers, overlapping: overlapping.slice(0, 5), openPending });
    }

    if (action === 'send') {
      const phoneOrderId = body.phoneOrderId;
      if (!phoneOrderId) return jsonError(corsHeaders, 'phoneOrderId is required.', 400);
      const { data: order, error } = await supabase.from('phone_orders').select('*').eq('id', phoneOrderId).single();
      if (error || !order) return jsonError(corsHeaders, 'Phone order not found.', 404);
      if (!order.customer_email) return jsonError(corsHeaders, 'Customer email is required.', 400);

      const expiresAt = order.link_expires_at || new Date(Date.now() + LINK_HOURS * 60 * 60 * 1000).toISOString();
      const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      const tokenHash = await sha256Hex(rawToken);
      const channel = order.sms_consent ? 'both' : 'email';
      const { error: linkError } = await supabase.from('phone_order_links').insert({
        phone_order_id: order.id,
        token_hash: tokenHash,
        channel,
        expires_at: expiresAt,
      });
      if (linkError) throw linkError;

      const siteUrl = resolvePublicSiteUrl(body.siteUrl);
      const url = `${siteUrl}/order-accept/${rawToken}`;
      const summary = `${order.service_name || 'Rental'} · ${order.total_price != null ? `$${Number(order.total_price).toFixed(2)}` : ''}`.trim();
      const mail = await sendEmail(
        order.customer_email,
        'Confirm your U-Fill Dumpsters booking',
        emailHtml(order.customer_name || 'Hello', url, summary),
      );
      let sms: { success?: boolean; skipped?: boolean; error?: string } = { skipped: true };
      if (order.sms_consent && order.customer_phone) {
        sms = await sendSms(
          order.customer_phone,
          `U-Fill Dumpsters: confirm your booking here ${url}`,
          { smsOptIn: true },
        );
      }

      await supabase.from('phone_orders').update({
        status: 'waiting_on_customer',
        link_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      return jsonOk(corsHeaders, {
        ok: true,
        emailSent: mail.success === true,
        emailError: mail.error || null,
        smsSent: sms.success === true && sms.skipped !== true,
        smsError: sms.error || null,
        expiresAt,
      });
    }

    if (action === 'extend') {
      const { data: order, error } = await supabase.from('phone_orders').select('*').eq('id', body.phoneOrderId).single();
      if (error || !order) return jsonError(corsHeaders, 'Phone order not found.', 404);
      if (order.extended_once) return jsonError(corsHeaders, 'This link was already extended once.', 400);
      const base = order.link_expires_at ? new Date(order.link_expires_at).getTime() : Date.now();
      const expiresAt = new Date(base + LINK_HOURS * 60 * 60 * 1000).toISOString();
      await supabase.from('phone_orders').update({
        link_expires_at: expiresAt,
        extended_once: true,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      await supabase.from('phone_order_links').update({ expires_at: expiresAt }).eq('phone_order_id', order.id);
      return jsonOk(corsHeaders, { ok: true, expiresAt });
    }

    if (action === 'expire') {
      const { data: order, error } = await supabase.from('phone_orders').select('*').eq('id', body.phoneOrderId).single();
      if (error || !order) return jsonError(corsHeaders, 'Phone order not found.', 404);
      if (order.status === 'accepted') return jsonError(corsHeaders, 'This order is already confirmed.', 400);

      if (order.booking_id) {
        const { data: booking } = await supabase.from('bookings').select('id,status,addons,payment_intent').eq('id', order.booking_id).maybeSingle();
        if (booking?.payment_intent) {
          try {
            const stripe = stripeClient();
            const pi = await stripe.paymentIntents.retrieve(booking.payment_intent);
            if (pi.status === 'requires_capture' || pi.status === 'requires_confirmation' || pi.status === 'requires_payment_method') {
              await stripe.paymentIntents.cancel(booking.payment_intent);
            } else if (pi.status === 'succeeded') {
              await stripe.refunds.create({ payment_intent: booking.payment_intent });
            }
          } catch (stripeError) {
            console.error('[phone-order-admin] payment release failed', stripeError);
          }
        }
        if (booking && String(booking.status) === 'pending_payment') {
          await releaseHold(supabase, booking);
        }
      }

      await supabase.from('phone_orders').update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      return jsonOk(corsHeaders, { ok: true });
    }

    if (action === 'authorize') {
      const bookingId = body.bookingId;
      if (!bookingId) return jsonError(corsHeaders, 'bookingId is required.', 400);
      const { data: booking, error } = await supabase
        .from('bookings')
        .select('id,total_price,subtotal_before_tax,tax_amount,payment_intent,client_secret,customer_id,customers(id,stripe_customer_id,email,name)')
        .eq('id', bookingId)
        .single();
      if (error || !booking) return jsonError(corsHeaders, 'Booking not found.', 404);

      const stripe = stripeClient();
      const amount = Math.max(50, Math.round(Number(booking.total_price || 0) * 100));
      if (booking.payment_intent) {
        const existing = await stripe.paymentIntents.retrieve(booking.payment_intent);
        if (existing.status === 'requires_capture' || existing.status === 'requires_payment_method' || existing.status === 'requires_confirmation') {
          return jsonOk(corsHeaders, {
            clientSecret: existing.client_secret || booking.client_secret,
            paymentIntentId: existing.id,
            reused: true,
          });
        }
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        capture_method: 'manual',
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: String(booking.id),
          order_channel: 'phone',
        },
      });
      const { error: saveError } = await supabase.from('bookings').update({
        payment_intent: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      }).eq('id', booking.id);
      if (saveError) throw saveError;
      return jsonOk(corsHeaders, {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    }

    return jsonError(corsHeaders, 'Unknown action.', 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Phone order request failed.';
    console.error('[phone-order-admin]', message);
    return jsonError(corsHeaders, message, 400);
  }
});
