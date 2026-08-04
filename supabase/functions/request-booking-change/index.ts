import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildRescheduleRequestChatMessage } from "../_shared/formatRescheduleChat.ts";

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function round2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

type AddressObj = {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted_address: string;
  isVerified?: boolean;
};

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.split('T')[0];
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return value;
  }
  return null;
}

function formatAddressParts(street: string, city: string, state: string, zip: string): string {
  const line1 = (street || '').trim();
  const line2 = [city, state].filter(Boolean).join(', ');
  const withZip = [line2, (zip || '').trim()].filter(Boolean).join(' ');
  return [line1, withZip].filter(Boolean).join(', ');
}

function parseAddressString(full: string): { street: string; city: string; state: string; zip: string } {
  const trimmed = (full || '').trim();
  if (!trimmed) return { street: '', city: '', state: '', zip: '' };

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ').trim();
    const match = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return { street, city, state: match[1].toUpperCase(), zip: match[2] };
    }
    const loose = stateZip.match(/^([A-Za-z]{2})\s*(.*)$/);
    if (loose) {
      return { street, city, state: loose[1].toUpperCase(), zip: (loose[2] || '').trim() };
    }
    return { street, city, state: stateZip, zip: '' };
  }

  if (parts.length === 2) {
    const street = parts[0];
    const rest = parts[1];
    const match = rest.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return { street, city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3] };
    }
    return { street, city: rest, state: '', zip: '' };
  }

  return { street: trimmed, city: '', state: '', zip: '' };
}

function normalizeAddress(input: unknown): AddressObj | null {
  if (!input) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = parseAddressString(trimmed);
    return {
      street: parsed.street || trimmed,
      city: parsed.city || '',
      state: parsed.state || '',
      zip: parsed.zip || '',
      formatted_address: trimmed,
    };
  }

  if (typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const street = String(obj.street || '').trim();
  const city = String(obj.city || '').trim();
  const state = String(obj.state || '').trim();
  const zip = String(obj.zip || '').trim();
  const formatted =
    String(obj.formatted_address || '').trim() ||
    formatAddressParts(street, city, state, zip);

  if (!street && !formatted) return null;

  return {
    street: street || formatted,
    city,
    state,
    zip,
    formatted_address: formatted,
  };
}

function addressesAreEqual(a: unknown, b: unknown): boolean {
  const left = (normalizeAddress(a)?.formatted_address || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const right = (normalizeAddress(b)?.formatted_address || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!left || !right) return false;
  return left === right;
}

function formatContactAddressForNote(addr: unknown): string | null {
  const normalized = normalizeAddress(addr);
  return normalized?.formatted_address || null;
}

function resolveToAddress(details: Record<string, unknown>): { address: AddressObj | null; kind: 'delivery' | 'contact' } {
  const contact = normalizeAddress(details.new_contact_address);
  if (contact) {
    return { address: contact, kind: 'contact' };
  }

  const deliveryObj = normalizeAddress(details.new_delivery_address_obj);
  if (deliveryObj) {
    return { address: deliveryObj, kind: 'delivery' };
  }

  const deliveryStr = normalizeAddress(details.new_delivery_address);
  return { address: deliveryStr, kind: 'delivery' };
}

function resolveFromAddress(booking: Record<string, unknown>): AddressObj | null {
  return (
    normalizeAddress(booking.delivery_address) ||
    normalizeAddress(booking.contact_address) ||
    normalizeAddress({
      street: booking.street,
      city: booking.city,
      state: booking.state,
      zip: booking.zip,
    })
  );
}

function buildDetailedNote(
  booking: Record<string, unknown>,
  reason: string,
  details: Record<string, unknown> | null
): string {
  if (!details) {
    return `Customer requested a booking change.\nNeeds scheduling approval.\n\n${reason}`;
  }

  // Portal reason is already human-readable — avoid duplicating technical dumps
  let note = (reason || "").trim();
  if (!note) {
    note = `Reschedule request for booking #${booking.id}.`;
  }
  if (!/scheduling approval|customer service approval/i.test(note)) {
    note = `Reschedule request for booking #${booking.id}.\nNeeds scheduling approval.\n\n${note}`;
  }

  if (details.is_manual_address && !/address verification/i.test(note)) {
    note += `\nAddress needs verification by customer service.`;
  }

  const inv = details.inventory_changes as Record<string, unknown> | undefined;
  if (inv) {
    const toReturn = inv.to_return;
    const toAllocate = inv.to_allocate;
    const hasReturn = Array.isArray(toReturn) && toReturn.length > 0;
    const hasAllocate = Array.isArray(toAllocate) && toAllocate.length > 0;
    if ((hasReturn || hasAllocate) && !/Equipment to return:|Equipment to allocate:/i.test(note)) {
      if (hasReturn) note += `\nEquipment to return: ${JSON.stringify(toReturn)}`;
      if (hasAllocate) note += `\nEquipment to allocate: ${JSON.stringify(toAllocate)}`;
    }
  }

  const submitted = details.request_timestamp ?? new Date().toISOString();
  if (!/Submitted\s*(at)?:/i.test(note)) {
    note += `\n\nSubmitted at: ${submitted}`;
  }
  return note;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const rescheduleDetails = body.rescheduleDetails ?? body;
    const reasonRaw =
      body.reason ??
      body.customer_comments ??
      rescheduleDetails?.customer_comments;
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';

    if (!bookingId) {
      throw new Error("Booking ID and reason are required.");
    }
    if (!reason) {
      throw new Error("Booking ID and reason are required.");
    }

    const numericBookingId = Number(bookingId);
    console.log(`[Request Booking Change] User ${user.id} requesting change for booking ${numericBookingId}`);

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, customers(*)")
      .eq("id", numericBookingId)
      .single();

    if (bookingError || !booking) throw new Error("Booking not found.");

    const customerDbId = user.user_metadata?.customer_db_id;
    if (customerDbId != null && Number(customerDbId) !== Number(booking.customer_id)) {
      console.warn(
        `[Request Booking Change] customer_db_id mismatch: user ${customerDbId} booking ${booking.customer_id}`
      );
    }

    const noteContent = buildDetailedNote(booking, reason, rescheduleDetails);
    const details = (rescheduleDetails && typeof rescheduleDetails === "object")
      ? rescheduleDetails as Record<string, unknown>
      : null;

    const originalTotal = round2(
      details?.original_total ?? details?.original_total_price ?? booking.total_price ?? 0
    );
    const newTotal = round2(
      details?.new_total ?? details?.new_total_price ?? details?.pricing?.total ?? originalTotal
    );
    const amountDue = round2(newTotal - originalTotal);
    const requestedAt = new Date().toISOString();

    const fromAddress = resolveFromAddress(booking);
    const { address: toAddress, kind: addressKind } = details
      ? resolveToAddress(details)
      : { address: null, kind: "delivery" as const };
    const explicitlyChanged = details?.address_changed === true;
    const addressChanged =
      Boolean(toAddress) &&
      (explicitlyChanged || (fromAddress ? !addressesAreEqual(toAddress, fromAddress) : true));

    const existingHistory = Array.isArray(booking.reschedule_history)
      ? [...booking.reschedule_history]
      : [];

    if (addressChanged && toAddress) {
      existingHistory.push({
        type: "address_change",
        status: "pending",
        requested_at: requestedAt,
        from_address: fromAddress,
        to_address: toAddress,
        distance_miles: details?.distance_miles ?? null,
        is_manual_address: Boolean(details?.is_manual_address),
        address_kind: addressKind,
      });
    }

    const originalServiceName =
      String(details?.original_service_name || booking.plan?.name || "").trim() || null;
    const newServiceName =
      String(details?.new_service_name || "").trim() || originalServiceName;

    const snapshotEntry = {
      type: "reschedule_request",
      status: "pending",
      requested_at: requestedAt,
      original_service_id: booking.plan?.id ?? null,
      original_service_name: originalServiceName,
      new_service_id: details?.new_service_id ?? null,
      new_service_name: newServiceName,
      original_drop_off_date: booking.drop_off_date,
      original_pickup_date: booking.pickup_date,
      original_drop_off_time: booking.drop_off_time_slot,
      original_pickup_time: booking.pickup_time_slot,
      new_drop_off_date: details ? toDateString(details.new_drop_off_date) : null,
      new_pickup_date: details ? toDateString(details.new_pickup_date) : null,
      new_drop_off_time: details?.new_drop_off_time ?? null,
      new_pickup_time: details?.new_pickup_time ?? null,
      original_address: fromAddress?.formatted_address ||
        String(details?.original_address_display || "").trim() || null,
      new_address: toAddress?.formatted_address ||
        String(details?.new_address_display || details?.new_delivery_address || "").trim() || null,
      address_changed: addressChanged,
      is_manual_address: Boolean(details?.is_manual_address),
      original_addons: details?.original_addons ?? [],
      new_addons: details?.new_addons ?? [],
      inventory_changes: details?.inventory_changes ?? null,
      pricing: details?.pricing ?? null,
      original_total: originalTotal,
      new_total: newTotal,
      amount_due: amountDue,
      customer_comments: details?.customer_comments ?? null,
    };
    existingHistory.push(snapshotEntry);

    const bookingUpdate: Record<string, unknown> = {
      status: "pending_review",
      notes: reason,
      reschedule_history: existingHistory,
      payment_delta_details: {
        amount_due: amountDue,
        original_total_price: originalTotal,
        new_total_price: newTotal,
        reason: "Reschedule request pending scheduling approval",
        state: "pending",
        requested_at: requestedAt,
        last_updated_at: requestedAt,
      },
    };

    if (!booking.receipt_original_snapshot) {
      bookingUpdate.receipt_original_snapshot = {
        captured_at: requestedAt,
        status: "pending_review",
        total_price: originalTotal,
        drop_off_date: booking.drop_off_date,
        pickup_date: booking.pickup_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_time_slot: booking.pickup_time_slot,
        plan: booking.plan,
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update(bookingUpdate)
      .eq("id", numericBookingId);

    if (updateError) throw new Error(`Failed to update booking: ${updateError.message}`);

    const hasStructuredReschedule =
      details &&
      (details.new_drop_off_date != null || details.new_service_id != null);

    if (hasStructuredReschedule) {
      const logRow = {
        booking_id: numericBookingId,
        request_type: "reschedule",
        request_status: "pending",
        reschedule_request_time: requestedAt,
        original_service_id: booking.plan?.id ?? null,
        original_drop_off_date: booking.drop_off_date,
        original_pickup_date: booking.pickup_date,
        original_drop_off_time: booking.drop_off_time_slot,
        original_pickup_time: booking.pickup_time_slot,
        original_total: originalTotal,
        new_total: newTotal,
        fee_amount: amountDue > 0 ? amountDue : null,
        refund_amount: amountDue < 0 ? Math.abs(amountDue) : null,
        new_service_id: details.new_service_id ?? null,
        new_drop_off_date: toDateString(details.new_drop_off_date),
        new_pickup_date: toDateString(details.new_pickup_date),
        new_drop_off_time: details.new_drop_off_time ?? null,
        new_pickup_time: details.new_pickup_time ?? null,
      };

      const { error: logError } = await supabaseAdmin
        .from("reschedule_history_logs")
        .insert(logRow);

      if (logError) {
        console.error(`[Request Booking Change] reschedule_history_logs insert failed:`, logError.message);
      }
    }

    const { error: noteError } = await supabaseAdmin.from("customer_notes").insert({
      customer_id: booking.customer_id,
      booking_id: numericBookingId,
      source: "Change Request",
      content: noteContent,
      author_type: "customer",
      is_read: false,
    });

    if (noteError) console.error(`Failed to add customer note: ${noteError.message}`);

    const chatMessage = buildRescheduleRequestChatMessage({
      bookingId: numericBookingId,
      originalBooking: booking,
      originalServiceName,
      newServiceName,
      newDropOffDate: details?.new_drop_off_date,
      newPickupDate: details?.new_pickup_date,
      newDropOffTime: details?.new_drop_off_time,
      newPickupTime: details?.new_pickup_time,
      originalAddons: details?.original_addons,
      newAddons: details?.new_addons,
      originalAddress: snapshotEntry.original_address,
      newAddress: snapshotEntry.new_address,
      addressChanged,
      isManualAddress: Boolean(details?.is_manual_address),
      comments: typeof details?.customer_comments === "string" ? details.customer_comments : null,
    });

    const { error: chatError } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: `cust_${booking.customer_id}`,
      customer_id: booking.customer_id,
      booking_id: numericBookingId,
      sender_type: "customer",
      message_content: chatMessage,
      is_read: false,
      message_context: {
        action: "reschedule_requested",
        booking_id: numericBookingId,
      },
    });

    if (chatError) {
      console.error(`[Request Booking Change] chat_messages insert failed:`, chatError.message);
    }

    console.log(`[Request Booking Change] Successfully processed request for booking ${numericBookingId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your reschedule request has been submitted for review.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Request Booking Change] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
