/**
 * Day-of curbside mattress reminder SMS for delivery bookings with mattress disposal.
 * Runs on a short cron; sends once per booking on Denver drop-off day.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendSms } from "../_shared/notify.ts";
import { denverCalendarDate } from "../_shared/pinTiming.ts";
import {
  mattressCurbsideSms,
  shouldShowMattressCurbsideReminder,
} from "../_shared/mattressDisposalReminder.ts";

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const today = denverCalendarDate();
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("id, status, drop_off_date, plan, addons, delivery_service, delivery_type, phone, email, customers(phone, sms_opt_in)")
      .eq("status", "Confirmed")
      .eq("drop_off_date", today)
      .is("mattress_curbside_reminder_sent_at", null);

    if (error) {
      console.error("[send-mattress-day-reminder] query failed:", error.message);
      return json(corsHeaders, { success: false, error: error.message }, 500);
    }

    const sent: Array<{ bookingId: number; skipped?: string }> = [];
    const failed: Array<{ bookingId: number; error: string }> = [];

    for (const booking of bookings ?? []) {
      if (!shouldShowMattressCurbsideReminder(booking as Record<string, unknown>)) {
        continue;
      }

      const claimedAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ mattress_curbside_reminder_sent_at: claimedAt })
        .eq("id", booking.id)
        .is("mattress_curbside_reminder_sent_at", null)
        .select("id")
        .maybeSingle();

      if (claimError) {
        failed.push({ bookingId: booking.id, error: claimError.message });
        continue;
      }
      if (!claimed) {
        sent.push({ bookingId: booking.id, skipped: "already_claimed" });
        continue;
      }

      const customer = (booking.customers || {}) as { phone?: string; sms_opt_in?: boolean };
      const phone = booking.phone || customer.phone;
      const smsOptIn = customer.sms_opt_in !== false;
      const smsResult = await sendSms(phone, mattressCurbsideSms(booking.id), { smsOptIn });

      if (!smsResult.success && !smsResult.skipped) {
        await supabase
          .from("bookings")
          .update({ mattress_curbside_reminder_sent_at: null })
          .eq("id", booking.id)
          .eq("mattress_curbside_reminder_sent_at", claimedAt);
        failed.push({ bookingId: booking.id, error: smsResult.error || "sms_failed" });
        continue;
      }

      sent.push({
        bookingId: booking.id,
        skipped: smsResult.skipped ? String(smsResult.reason || "skipped") : undefined,
      });
    }

    console.log("[send-mattress-day-reminder] done", { today, sent: sent.length, failed: failed.length });
    return json(corsHeaders, { success: true, today, sent, failed });
  } catch (error) {
    console.error("[send-mattress-day-reminder] Error:", error);
    return json(corsHeaders, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
