import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePortalCaller } from "../_shared/phoneOrderAuth.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CLOSED = new Set(["Completed", "Cancelled", "flagged", "booking_not_finished"]);
const KEEP_STATUS = new Set(["Delivered", "waiting_to_be_returned", "late_return", "failure_to_return"]);

type AddressObj = {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted_address: string;
};

function formatAddressParts(street: string, city: string, state: string, zip: string): string {
  const line1 = (street || "").trim();
  const line2 = [city, state].filter(Boolean).join(", ");
  const withZip = [line2, (zip || "").trim()].filter(Boolean).join(" ");
  return [line1, withZip].filter(Boolean).join(", ");
}

function asAddress(input: Record<string, unknown> | null | undefined): AddressObj | null {
  if (!input) return null;
  const street = String(input.street || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const zip = String(input.zip || "").trim();
  const formatted = String(input.formatted_address || "").trim() || formatAddressParts(street, city, state, zip);
  if (!street && !formatted) return null;
  return { street: street || formatted, city, state, zip, formatted_address: formatted };
}

function sameAddress(a: AddressObj | null, b: AddressObj | null): boolean {
  const left = (a?.formatted_address || "").toLowerCase().replace(/\s+/g, " ").trim();
  const right = (b?.formatted_address || "").toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(left) && left === right;
}

function isOpen(booking: Record<string, unknown>): boolean {
  if (booking.returned_at) return false;
  return !CLOSED.has(String(booking.status || ""));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const auth = await requirePortalCaller(req, corsHeaders);
    if (auth.error) return auth.error;
    const user = auth.user;

    const body = await req.json();
    const requested = asAddress(body);
    if (!requested?.street || !requested.city || !requested.state || !requested.zip) {
      return json({ error: "A complete address is required." }, 400);
    }

    const metadataId = user.user_metadata?.customer_db_id;
    let customerQuery = supabaseAdmin.from("customers").select("*");
    if (metadataId != null && metadataId !== "") {
      customerQuery = customerQuery.eq("id", Number(metadataId));
    } else {
      customerQuery = customerQuery.eq("user_id", user.id);
    }
    const { data: customer, error: customerError } = await customerQuery.maybeSingle();
    if (customerError || !customer) return json({ error: "Customer profile was not found." }, 404);
    if (customer.user_id && customer.user_id !== user.id) {
      return json({ error: "This profile belongs to another customer." }, 403);
    }

    const fullName = `${String(body.first_name || "").trim()} ${String(body.last_name || "").trim()}`.trim();
    const profileUpdate: Record<string, unknown> = {
      first_name: String(body.first_name || "").trim(),
      last_name: String(body.last_name || "").trim(),
      name: fullName || customer.name,
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      sms_opt_in: body.sms_opt_in === true,
      sms_marketing_opt_in: body.sms_marketing_opt_in === true,
    };

    const current = asAddress(customer);
    if (sameAddress(current, requested)) {
      const { error } = await supabaseAdmin.from("customers").update(profileUpdate).eq("id", customer.id);
      if (error) throw new Error(error.message);
      return json({ addressPending: false });
    }

    const requestedAt = new Date().toISOString();
    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("customer_id", customer.id);
    if (bookingsError) throw new Error(bookingsError.message);

    const openBookings = (bookings || []).filter((booking) => isOpen(booking as Record<string, unknown>));
    const bookingIds: number[] = [];
    let history = Array.isArray(customer.address_history) ? [...customer.address_history] : [];

    for (const booking of openBookings) {
      bookingIds.push(Number(booking.id));
      const hasOrder = history.some(
        (entry) => entry?.source === "order" && Number(entry.booking_id) === Number(booking.id),
      );
      if (!hasOrder && current) {
        history.push({
          source: "order",
          status: "recorded",
          address: current,
          booking_id: booking.id,
          recorded_at: booking.created_at || requestedAt,
        });
      }

      const existing = Array.isArray(booking.reschedule_history) ? [...booking.reschedule_history] : [];
      const withoutPending = existing.filter(
        (entry) => !(entry?.type === "address_change" && entry?.status === "pending" && entry?.source === "profile"),
      );
      withoutPending.push({
        type: "address_change",
        status: "pending",
        source: "profile",
        requested_at: requestedAt,
        from_address: current,
        to_address: requested,
        address_kind: "profile",
      });

      const bookingUpdate: Record<string, unknown> = { reschedule_history: withoutPending };
      const alreadyOut = Boolean(booking.delivered_at) || KEEP_STATUS.has(String(booking.status || ""));
      if (!alreadyOut && (booking.status === "Confirmed" || booking.status === "Rescheduled")) {
        bookingUpdate.status = "pending_review";
      }

      const { error: updateError } = await supabaseAdmin.from("bookings").update(bookingUpdate).eq("id", booking.id);
      if (updateError) throw new Error(updateError.message);
    }

    history = history.filter(
      (entry) => !(entry?.source === "profile" && entry?.status === "pending"),
    );
    history.push({
      source: "profile",
      status: "pending",
      from_address: current,
      to_address: requested,
      booking_ids: bookingIds,
      requested_at: requestedAt,
    });

    profileUpdate.address_history = history;
    profileUpdate.pending_address = {
      ...requested,
      source: "profile",
      status: "pending",
      requested_at: requestedAt,
      booking_ids: bookingIds,
    };

    const { error: saveError } = await supabaseAdmin.from("customers").update(profileUpdate).eq("id", customer.id);
    if (saveError) throw new Error(saveError.message);

    const bookingLabel = bookingIds.length ? ` Bookings: ${bookingIds.map((id) => `#${id}`).join(", ")}.` : "";
    const note = `Address change submitted from the customer profile and needs verification.\nFrom: ${current?.formatted_address || "N/A"}\nTo: ${requested.formatted_address}.${bookingLabel}`;

    await supabaseAdmin.from("customer_notes").insert({
      customer_id: customer.id,
      booking_id: bookingIds[0] || null,
      source: "Address Change",
      content: note,
      author_type: "customer",
      is_read: false,
    });

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: `cust_${customer.id}`,
      customer_id: customer.id,
      booking_id: bookingIds[0] || null,
      sender_type: "customer",
      message_content: note,
      is_read: false,
      message_context: { action: "address_change_requested", booking_ids: bookingIds },
    });

    const { error: emailError } = await supabaseAdmin.functions.invoke("send-reschedule-confirmation-email", {
      body: {
        bookingId: bookingIds[0],
        customerId: customer.id,
        emailType: "address_under_review",
        fromAddress: current?.formatted_address || "",
        toAddress: requested.formatted_address,
      },
    });
    if (emailError) {
      console.warn("[request-profile-address-change] under-review email failed:", emailError.message);
    }

    return json({ addressPending: true, bookingIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit the address change.";
    console.error("[request-profile-address-change]", message);
    return json({ error: message }, 500);
  }
});
