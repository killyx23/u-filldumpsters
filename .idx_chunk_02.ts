      .maybeSingle();

    const email = String(booking?.email || "").trim();
    if (!email) {
      return { data: null, error: { message: "Unsent token booking has no email" }, reused: true };
    }

    const firstName = String(
      booking?.first_name ||
        String(booking?.name || "there").split(" ")[0] ||
        "there",
    );

    return {
      data: {
        token: String(unsent.token),
        customer_id: unsent.customer_id != null
          ? Number(unsent.customer_id)
          : booking?.customer_id != null
          ? Number(booking.customer_id)
          : null,
        email,
        first_name: firstName,
        site_path: `/how-can-we-do-better?token=${unsent.token}`,
      },
      error: null,
      reused: true,
    };
  }

  const created = await createFeedbackTokenRow(supabase, bookingId);
  if (created.error) {
    return { data: null, error: { message: created.error.message }, reused: false };
  }

  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!row?.token || !row?.email) {
    return { data: null, error: { message: "Could not create feedback token" }, reused: false };
  }

  return {
    data: {
      token: String(row.token),
      customer_id: row.customer_id != null ? Number(row.customer_id) : null,
      email: String(row.email),
      first_name: String(row.first_name || "there"),
      site_path: String(row.site_path || `/how-can-we-do-better?token=${row.token}`),
    },
    error: null,
    reused: false,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    let bookingId = Number(body?.bookingId ?? body?.booking_id ?? 0);
    const pendingIdRaw = body?.pendingId ?? body?.pending_id ?? null;
    const pendingId =
      typeof pendingIdRaw === "string" && pendingIdRaw.length > 0 ? pendingIdRaw : null;
    let reason = String(body?.reason || "left_early").toLowerCase().trim();
    if (!ALLOWED_REASONS.has(reason)) reason = "left_early";

    if ((!Number.isFinite(bookingId) || bookingId <= 0) && !pendingId) {
      return jsonResponse(
        corsHeaders,
        { ok: false, error: "bookingId or pendingId required" },
        400,
      );
    }
