        );
      }
    }

    const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
      "finalize_unfinished_checkout",
      {
        p_booking_id: bookingId,
        p_reason: reason,
      },
    );

    if (finalizeError) {
      console.error("[end-unfinished-checkout] finalize failed:", finalizeError);
      return jsonResponse(corsHeaders, { ok: false, error: finalizeError.message }, 400);
    }

    if (finalizeResult?.ok === false && finalizeResult?.error === "not_pending_payment") {
      return jsonResponse(
        corsHeaders,
        {
          ok: false,
          error: "not_pending_payment",
          skipped_reason: "not_pending_payment",
          booking_id: bookingId,
        },
        400,
      );
    }

    // If booking was created already as booking_not_finished from pending,
    // finalize returns already_finalized — still send survey email below
    // unless a sibling Confirmed booking means this checkout converted.
    if (finalizeResult?.ok === false) {
      return jsonResponse(
        corsHeaders,
        { ok: false, error: finalizeResult?.error || "finalize failed", booking_id: bookingId },
        400,
      );
    }

    if (
      finalizeResult?.skip_email ||
      finalizeResult?.skipped ||
      finalizeResult?.skipped_reason === "already_converted"
    ) {
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        skip_email: true,
        skipped_reason: finalizeResult?.skipped_reason || "already_converted",
        email_sent: false,
        email_skipped: "already_converted",
        booking_id: bookingId,
        converted_booking_id: finalizeResult?.converted_booking_id ?? null,
        restocked: finalizeResult?.restocked ?? false,
        abandoned_checkout_id: finalizeResult?.abandoned_checkout_id ?? null,
      });
    }

    const abandonedCheckoutId = finalizeResult?.abandoned_checkout_id ?? null;

    let crmStatus: string | null = null;
    if (abandonedCheckoutId) {
      const { data: crmRow } = await supabase
        .from("abandoned_checkouts")
        .select("status")
        .eq("id", abandonedCheckoutId)
        .maybeSingle();
      crmStatus = crmRow?.status ? String(crmRow.status) : null;
    }

    // Ensure customer exists before feedback token (promoted pending rows often have no customer_id)
    await ensureBookingCustomer(supabase, bookingId);

    // Already emailed for this booking — do not send again
    const { data: sentTokens } = await supabase
      .from("feedback_tokens")
      .select("id, email_sent_at")
      .eq("booking_id", bookingId)
