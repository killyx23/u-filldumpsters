
    // Already paid in another tab — never invent an unfinished booking or survey email.
    // If this tab still has an unpaid hold, fall through so finalize can close it
    // without restocking.
    let alreadyConverted = false;
    let convertedBookingId = null;
    if (pendingId) {
      const { data: completion } = await supabase.rpc("get_checkout_completion_status", {
        p_pending_id: pendingId,
      });
      if (completion?.completed) {
        alreadyConverted = true;
        convertedBookingId = Number(completion.booking_id) || null;
      }
    }

    // Stale session hold: if bookingId is not an open checkout, promote from pending instead.
    if (Number.isFinite(bookingId) && bookingId > 0 && pendingId) {
      const { data: bookingRow } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .maybeSingle();
      const status = String(bookingRow?.status || "").toLowerCase();
      if (
        status &&
        status !== "pending_payment" &&
        status !== "booking_not_finished"
      ) {
        bookingId = 0;
      }
    }

    if (alreadyConverted && (!Number.isFinite(bookingId) || bookingId <= 0)) {
      console.log(
        `[end-unfinished-checkout] skip already_converted pending=${pendingId} booking=${convertedBookingId}`,
      );
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        skip_email: true,
        skipped_reason: "already_converted",
        email_sent: false,
        email_skipped: "already_converted",
        booking_id: convertedBookingId,
        converted_booking_id: convertedBookingId,
        restocked: false,
      });
    }

    // Step 6–8 leavers: promote pending → booking_not_finished first
    if ((!Number.isFinite(bookingId) || bookingId <= 0) && pendingId) {
      const { data: promoted, error: promoteError } = await supabase.rpc(
        "create_unfinished_booking_from_pending",
        { p_pending_id: pendingId },
      );
      if (promoteError) {
        console.error("[end-unfinished-checkout] promote failed:", promoteError);
        return jsonResponse(corsHeaders, { ok: false, error: promoteError.message }, 400);
      }
      if (promoted?.skipped || promoted?.reason === "already_converted") {
        const convertedId = Number(promoted?.converted_booking_id || promoted?.booking_id) || convertedBookingId;
        return jsonResponse(corsHeaders, {
          ok: true,
          skipped: true,
          skip_email: true,
          skipped_reason: "already_converted",
          email_sent: false,
          email_skipped: "already_converted",
          booking_id: convertedId,
          converted_booking_id: convertedId,
          restocked: false,
        });
      }
      bookingId = Number(promoted?.booking_id);
      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        return jsonResponse(
          corsHeaders,
          { ok: false, error: "Could not create unfinished booking from pending" },
          400,
