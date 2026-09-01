/**
 * Shared PIN customer notifications (email + SMS via send-booking-confirmation).
 *
 * First message (pin_update) is claimed on bookings.pin_notification_sent_at.
 * 1-hour reminder (pin_reminder) is claimed on bookings.pin_reminder_sent_at.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function invokePinEmail(
  supabase: SupabaseClient,
  bookingId: unknown,
  emailType: "pin_update" | "pin_reminder",
  pin: string,
  startTime: string,
  endTime: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: bookingId,
      email_type: emailType,
      pin,
      start_time: startTime,
      end_time: endTime,
    },
  });
  if (error || data?.success === false) {
    return { ok: false, error: error?.message || data?.error || String(data) };
  }
  return { ok: true };
}

export async function notifyPinReady(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  pin: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const bookingId = booking.id;
  if (bookingId == null) return;

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("bookings")
    .update({ pin_notification_sent_at: claimedAt })
    .eq("id", bookingId)
    .is("pin_notification_sent_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error(`[pinNotify] Claim failed for booking #${bookingId}:`, claimError.message);
    return;
  }
  if (!claimed) return;

  const sent = await invokePinEmail(supabase, bookingId, "pin_update", pin, startTime, endTime);
  if (!sent.ok) {
    console.error(`[pinNotify] Email notification failed for booking #${bookingId}:`, sent.error);
    await supabase
      .from("bookings")
      .update({ pin_notification_sent_at: null })
      .eq("id", bookingId)
      .eq("pin_notification_sent_at", claimedAt);
    return;
  }

  booking.pin_notification_sent_at = claimedAt;
  await supabase
    .from("rental_access_codes")
    .update({ notified_at: claimedAt })
    .eq("order_id", bookingId)
    .eq("status", "active");
}

export async function notifyPinReminder(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  pin: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const bookingId = booking.id;
  if (bookingId == null) return;
  if (!booking.pin_notification_sent_at) return;

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("bookings")
    .update({ pin_reminder_sent_at: claimedAt })
    .eq("id", bookingId)
    .is("pin_reminder_sent_at", null)
    .not("pin_notification_sent_at", "is", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error(`[pinNotify] Reminder claim failed for booking #${bookingId}:`, claimError.message);
    return;
  }
  if (!claimed) return;

  const sent = await invokePinEmail(supabase, bookingId, "pin_reminder", pin, startTime, endTime);
  if (!sent.ok) {
    console.error(`[pinNotify] Reminder email failed for booking #${bookingId}:`, sent.error);
    await supabase
      .from("bookings")
      .update({ pin_reminder_sent_at: null })
      .eq("id", bookingId)
      .eq("pin_reminder_sent_at", claimedAt);
  }
}
