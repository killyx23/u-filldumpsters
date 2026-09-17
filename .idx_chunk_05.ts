      .not("email_sent_at", "is", null)
      .limit(1);

    if (Array.isArray(sentTokens) && sentTokens.length > 0) {
      return jsonResponse(corsHeaders, {
        ok: true,
        booking_id: bookingId,
        reason,
        restocked: finalizeResult?.restocked ?? false,
        email_sent: false,
        email_skipped: "already_sent",
        abandoned_checkout_id: abandonedCheckoutId,
        crm_status: crmStatus,
      });
    }

    const { data: row, error: tokenError, reused } = await resolveFeedbackTokenForEmail(
      supabase,
      bookingId,
    );

    if (tokenError || !row?.token || !row?.email) {
      console.error("[end-unfinished-checkout] feedback token failed:", tokenError);
      return jsonResponse(corsHeaders, {
        ok: true,
        booking_id: bookingId,
        reason,
        restocked: finalizeResult?.restocked ?? false,
        email_sent: false,
        email_error: tokenError?.message || "Could not create feedback token",
        abandoned_checkout_id: abandonedCheckoutId,
        crm_status: crmStatus,
      });
    }

    const { data: unsubToken } = await supabase.rpc("create_unsubscribe_token", {
      p_abandoned_checkout_id: abandonedCheckoutId,
      p_booking_id: bookingId,
      p_customer_id: row.customer_id ?? null,
      p_email: row.email,
    });

    const siteUrl = normalizeSiteUrl(body?.siteUrl);
    const feedbackUrl = `${siteUrl}${row.site_path}`;
    const contactUrl = `${siteUrl}/contact`;
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken, siteUrl) || contactUrl;

    const html = buildEarlyLeaveEmailHtml({
      firstName: String(row.first_name || "there"),
      feedbackUrl,
      contactUrl,
      unsubscribeUrl,
    });

    const emailResult = await sendEmail(String(row.email), EARLY_LEAVE_EMAIL_SUBJECT, html);

    if (emailResult.success) {
      await supabase
        .from("feedback_tokens")
        .update({
          email_sent_at: new Date().toISOString(),
          email_message_id: emailResult.messageId || null,
        })
        .eq("token", row.token);
    } else {
      console.error("[end-unfinished-checkout] email failed:", emailResult.error);
    }

    console.log(
      `[end-unfinished-checkout] booking=${bookingId} reason=${reason} crm=${abandonedCheckoutId} email=${emailResult.success} reused_token=${reused} restocked=${finalizeResult?.restocked}`,
    );

    return jsonResponse(corsHeaders, {
      ok: true,
      booking_id: bookingId,
      reason,
      restocked: finalizeResult?.restocked ?? false,
      email_sent: emailResult.success,
      email_error: emailResult.success ? null : emailResult.error,
      email_token_reused: reused,
