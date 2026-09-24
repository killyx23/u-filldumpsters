      abandoned_checkout_id: abandonedCheckoutId,
      crm_updated: Boolean(abandonedCheckoutId),
      crm_status: crmStatus,
      messageId: emailResult.messageId || null,
    });
  } catch (err) {
    console.error("[end-unfinished-checkout] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
