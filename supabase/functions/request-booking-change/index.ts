import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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
    return `Customer requested a booking change.\n\n${reason}`;
  }

  let note = `Customer requested to reschedule booking #${booking.id}. Admin approval required.\n\n`;
  note += reason;
  note += '\n\n--- Structured request ---\n';

  if (details.new_service_id != null) {
    note += `New service ID: ${details.new_service_id}\n`;
  }
  note += `New drop-off: ${toDateString(details.new_drop_off_date) ?? 'N/A'} ${details.new_drop_off_time ?? ''}\n`;
  note += `New pickup: ${toDateString(details.new_pickup_date) ?? 'N/A'} ${details.new_pickup_time ?? ''}\n`;

  if (details.new_delivery_address) {
    note += `Delivery address: ${details.new_delivery_address}\n`;
  }
  const contactNote = formatContactAddressForNote(details.new_contact_address);
  if (contactNote) {
    note += `Contact address: ${contactNote}\n`;
  }
  if (details.distance_miles != null) {
    note += `Distance (miles): ${details.distance_miles}\n`;
  }
  if (details.is_manual_address) {
    note += `Address flagged for manual verification.\n`;
  }

  const inv = details.inventory_changes as Record<string, unknown> | undefined;
  if (inv) {
    note += `\nInventory — to return: ${JSON.stringify(inv.to_return ?? [])}\n`;
    note += `Inventory — to allocate: ${JSON.stringify(inv.to_allocate ?? [])}\n`;
  }

  note += `\nSubmitted at: ${details.request_timestamp ?? new Date().toISOString()}`;
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

    const bookingUpdate: Record<string, unknown> = {
      status: "pending_review",
      notes: reason,
    };

    // Persist pending address change in reschedule_history (do not overwrite live address yet)
    if (rescheduleDetails) {
      const { address: toAddress, kind: addressKind } = resolveToAddress(rescheduleDetails);
      const fromAddress = resolveFromAddress(booking);
      const explicitlyChanged = rescheduleDetails.address_changed === true;
      const addressChanged =
        Boolean(toAddress) &&
        (explicitlyChanged || (fromAddress ? !addressesAreEqual(toAddress, fromAddress) : true));

      if (addressChanged && toAddress) {
        const existingHistory = Array.isArray(booking.reschedule_history)
          ? booking.reschedule_history
          : [];
        const addressEntry = {
          type: 'address_change',
          status: 'pending',
          requested_at: new Date().toISOString(),
          from_address: fromAddress,
          to_address: toAddress,
          distance_miles: rescheduleDetails.distance_miles ?? null,
          is_manual_address: Boolean(rescheduleDetails.is_manual_address),
          address_kind: addressKind,
        };
        bookingUpdate.reschedule_history = [...existingHistory, addressEntry];
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update(bookingUpdate)
      .eq("id", numericBookingId);

    if (updateError) throw new Error(`Failed to update booking: ${updateError.message}`);

    const hasStructuredReschedule =
      rescheduleDetails &&
      (rescheduleDetails.new_drop_off_date != null ||
        rescheduleDetails.new_service_id != null);

    if (hasStructuredReschedule) {
      const logRow = {
        booking_id: numericBookingId,
        request_type: 'reschedule',
        request_status: 'pending',
        reschedule_request_time: new Date().toISOString(),
        original_service_id: booking.plan?.id ?? null,
        original_drop_off_date: booking.drop_off_date,
        original_pickup_date: booking.pickup_date,
        original_drop_off_time: booking.drop_off_time_slot,
        original_pickup_time: booking.pickup_time_slot,
        original_total: booking.total_price ?? null,
        new_service_id: rescheduleDetails.new_service_id ?? null,
        new_drop_off_date: toDateString(rescheduleDetails.new_drop_off_date),
        new_pickup_date: toDateString(rescheduleDetails.new_pickup_date),
        new_drop_off_time: rescheduleDetails.new_drop_off_time ?? null,
        new_pickup_time: rescheduleDetails.new_pickup_time ?? null,
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
