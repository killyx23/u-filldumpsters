      .select("id")
      .single();

    if (createError) {
      console.error("[end-unfinished-checkout] ensureBookingCustomer create failed:", createError);
      return null;
    }
    customerId = created?.id ? Number(created.id) : null;
  }

  if (customerId) {
    await supabase.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
  }

  return customerId;
}

async function createFeedbackTokenRow(
  supabase: SupabaseClient,
  bookingId: number,
) {
  const attempt = await supabase.rpc("create_early_leave_feedback_token", {
    p_booking_id: bookingId,
  });

  if (!attempt.error) {
    return attempt;
  }

  const message = String(attempt.error.message || "").toLowerCase();
  if (message.includes("no customer") || message.includes("customer")) {
    const customerId = await ensureBookingCustomer(supabase, bookingId);
    if (customerId) {
      return supabase.rpc("create_early_leave_feedback_token", {
        p_booking_id: bookingId,
      });
    }
  }

  return attempt;
}

type FeedbackTokenPayload = {
  token: string;
  customer_id: number | null;
  email: string;
  first_name: string;
  site_path: string;
};

/**
 * Prefer an existing unsent token (retry after Brevo/DNS blips).
 * Only create a new token when none exist for this booking.
 */
async function resolveFeedbackTokenForEmail(
  supabase: SupabaseClient,
  bookingId: number,
): Promise<{ data: FeedbackTokenPayload | null; error: { message: string } | null; reused: boolean }> {
  const { data: existing, error: existingError } = await supabase
    .from("feedback_tokens")
    .select("id, token, customer_id, email_sent_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (existingError) {
    return { data: null, error: { message: existingError.message }, reused: false };
  }

  const rows = Array.isArray(existing) ? existing : [];
  if (rows.some((r) => r.email_sent_at)) {
    return { data: null, error: null, reused: false };
  }

  const unsent = rows.find((r) => r?.token && !r.email_sent_at);
  if (unsent?.token) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("email, first_name, name, customer_id")
      .eq("id", bookingId)
