/**
 * Shared "PIN is ready" notification (email + SMS).
 *
 * Extracted from ensure-lock-pin-ready so both the reconciler and the
 * igloohome-webhook job-complete handler can notify the customer the moment
 * a PIN is actually confirmed on the lock, instead of waiting for the next
 * cron sweep.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function notifyPinReady(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  pin: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  if (booking.pin_notification_sent_at) return;

  const { error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime,
    },
  });
  if (error) {
    console.error(`[pinNotify] Email notification failed for booking #${booking.id}:`, error.message);
  } else {
    const now = new Date().toISOString();
    await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", booking.id);
    await supabase
      .from("rental_access_codes")
      .update({ notified_at: now })
      .eq("order_id", booking.id)
      .eq("status", "active");
  }

  try {
    const { data: customer } = await supabase
      .from("customers")
      .select("phone, sms_opt_in")
      .eq("id", booking.customer_id)
      .maybeSingle();
    const phone = customer?.phone || booking.phone || "";
    if (customer?.sms_opt_in === false || !phone) return;
    const digits = String(phone).replace(/\D/g, "");
    const to = digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
      ? `+${digits}`
      : null;
    if (!to) return;
    const site = (Deno.env.get("SITE_URL") || "https://u-filldumpsters.com").replace(/\/$/, "");
    const content =
      `U-Fill Dumpsters: Your access PIN for Order #${booking.id} is ${pin}. View: ${site}/customer-portal?tab=access-codes`;
    const key = Deno.env.get("BREVO_API_KEY");
    if (!key) return;
    await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: (Deno.env.get("BREVO_SMS_SENDER") || "UFillDump").slice(0, 11),
        recipient: to,
        content,
        type: "transactional",
      }),
    });
  } catch (err) {
    console.error(`[pinNotify] SMS notification failed for booking #${booking.id}:`, err);
  }
}
