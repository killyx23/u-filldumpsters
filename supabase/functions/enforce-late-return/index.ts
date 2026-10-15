/**
 * Late-return sequence for yard pickups that are still out.
 * The extra hour after the scheduled return is internal.
 *
 * When that hour ends, one email and text include the late fee and a two-hour
 * return code. Those two hours start then. A return or a portal extension in
 * that window leaves only the late fee.
 *
 * If the rental is still out when the two hours end, the failure-to-return
 * charges are recorded and a code through 5:00 AM Mountain Time is sent.
 * Admin charges both fees from the customer file. Nothing is charged here.
 */

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { bookingNeedsYardLockPin } from "../_shared/deliveryBooking.ts";
import { getBookingWindow } from "../_shared/pinTiming.ts";
import { businessWallTimeToUtc } from "../_shared/parseBookingTimeSlot.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { createAlgoPinWithVariance } from "../_shared/algoPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const STOP_STATUSES = new Set([
  "pending_checklist",
  "Returned",
  "Completed",
  "Cancelled",
  "cancellation_pending",
]);

function round2(amount: unknown) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

function money(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function denverLabel(value: Date | string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function nextMorningFiveAm(pickupDate: string): Date | null {
  const match = String(pickupDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  const ymd = cursor.toISOString().slice(0, 10);
  return businessWallTimeToUtc(ymd, { hour: 5, minute: 0, second: 0 });
}

function dayRate(booking: Record<string, unknown>) {
  const plan = (booking.plan || {}) as { base_price?: number; price?: number };
  const base = Number(plan.base_price);
  if (base > 0) return round2(base);
  const price = Number(plan.price);
  return price > 0 ? round2(price) : 0;
}

function equipmentIdOf(item: { equipment_id?: number; dbId?: number; id?: number | string }) {
  const raw = Number(item?.equipment_id ?? item?.dbId ?? item?.id);
  return Number.isInteger(raw) && raw > 0 && raw !== 7 ? raw : null;
}

function isRentalAddon(item: Record<string, unknown>) {
  const id = equipmentIdOf(item as { equipment_id?: number; dbId?: number; id?: number });
  if (id === 3) return false;
  const type = String(item?.type || "").toLowerCase();
  if (type === "purchase" || type === "consumable" || type === "service") return false;
  if (type === "rental") return true;
  if (item?.additionalDayPrice != null || item?.additional_day_price != null) return true;
  return id === 1 || id === 2;
}

type FeeLine = { name: string; kind: string; amount: number };

function failureLines(booking: Record<string, unknown>, catalogRates: Record<number, number>): FeeLine[] {
  const lines: FeeLine[] = [];
  const trailer = dayRate(booking);
  if (trailer > 0) {
    lines.push({ name: "Trailer extra day", kind: "extra_day", amount: trailer });
    lines.push({ name: "Trailer failure to return", kind: "failure_to_return", amount: trailer });
  }
  const equipment = Array.isArray((booking.addons as { equipment?: unknown[] } | null)?.equipment)
    ? (booking.addons as { equipment: Record<string, unknown>[] }).equipment
    : [];
  for (const item of equipment) {
    if (!isRentalAddon(item)) continue;
    const id = equipmentIdOf(item as { equipment_id?: number; dbId?: number; id?: number });
    const stored = (item.additionalDayPrice ?? item.additional_day_price) as number | undefined;
    const rate = round2(stored != null ? stored : (id != null ? catalogRates[id] ?? 0 : 0));
    const qty = Number(item.quantity || 1);
    const amount = round2(rate * qty);
    if (!(amount > 0)) continue;
    const label = String(item.name || item.label || "Rental equipment");
    lines.push({ name: `${label} extra day`, kind: "extra_day", amount });
    lines.push({ name: `${label} failure to return`, kind: "failure_to_return", amount });
  }
  return lines;
}

function stillOut(booking: Record<string, unknown>, now: Date) {
  if (booking.returned_at) return false;
  if (STOP_STATUSES.has(String(booking.status || ""))) return false;
  if (!booking.rented_out_at) return false;
  if (!bookingNeedsYardLockPin(booking)) return false;
  const { graceEndMs } = getBookingWindow(booking as never);
  return Number.isFinite(graceEndMs) && now.getTime() >= graceEndMs;
}

async function portalMessage(booking: Record<string, unknown>, message: string, action: string) {
  if (!booking.customer_id) return;
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: `cust_${booking.customer_id}`,
    customer_id: booking.customer_id,
    booking_id: booking.id,
    sender_type: "admin",
    message_content: message,
    is_read: false,
    message_severity: "urgent",
    message_context: { action, order_id: booking.id, source: "enforce-late-return" },
  });
}

function shell(title: string, body: string) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e3a8a;color:#fff;padding:20px 24px;"><h1 style="margin:0;font-size:22px;">${title}</h1></div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">${body}</div>
  </div>
</body></html>`;
}

async function notify(booking: Record<string, unknown>, subject: string, html: string, sms: string) {
  const customer = (booking.customers || {}) as { email?: string; phone?: string; sms_opt_in?: boolean };
  const email = String(booking.email || customer.email || "");
  const phone = String(booking.phone || customer.phone || "");
  const smsOptIn = customer.sms_opt_in !== false;
  const emailResult = email ? await sendEmail(email, subject, html) : { success: false, error: "No email" };
  const smsResult = await sendSms(phone, sms, { smsOptIn });
  return { emailResult, smsResult };
}

async function issuePin(booking: Record<string, unknown>, start: string, end: string, label: string) {
  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
  if (!clientId || !clientSecret || !lockId) return { pin: "", end };
  const oauth = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  if (!oauth.token) return { pin: "", end };
  const algo = await createAlgoPinWithVariance({
    supabase: supabaseAdmin,
    accessToken: oauth.token,
    lockId,
    startDate: start,
    endDate: end,
    accessName: `Dump Trailer Rental - Order #${booking.id} (${label})`,
    insertRow: {
      order_id: booking.id,
      customer_email: booking.email || "",
      customer_phone: booking.phone || "",
      status: "active",
      lock_confirmed_at: new Date().toISOString(),
      confirm_attempts: 0,
    },
  });
  if (!algo.success) return { pin: "", end };
  return { pin: algo.pin, end: algo.endDate };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const now = new Date();
    const siteUrl = normalizeSiteUrl(null);
    const portalUrl = `${siteUrl}/customer-portal`;
    const { data: feeRow } = await supabaseAdmin
      .from("charges_and_fees")
      .select("fee_value")
      .eq("fee_key", "late_return_fee")
      .maybeSingle();
    const lateFee = round2(feeRow?.fee_value);

    const { data: bookings, error } = await supabaseAdmin
      .from("bookings")
      .select("*, customers(email, phone, sms_opt_in, name)")
      .not("rented_out_at", "is", null)
      .is("returned_at", null)
      .is("failure_to_return_notice_at", null);
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const booking of bookings || []) {
      if (!stillOut(booking, now)) continue;
      const orderId = Number(booking.id);
      const returnLabel = denverLabel(getBookingWindow(booking as never).endIso || booking.pickup_date);
      const deadline = nextMorningFiveAm(String(booking.pickup_date || ""));
      const deadlineLabel = deadline ? denverLabel(deadline) : "5:00 AM Mountain Time the next morning";
      const name = booking.name || booking.customers?.name || "there";
      const fees = (booking.fees && typeof booking.fees === "object") ? booking.fees : {};

      if (!booking.late_return_notice_at) {
        const pinEnd = new Date(now.getTime() + TWO_HOURS_MS).toISOString();
        const issued = await issuePin(booking, now.toISOString(), pinEnd, "late return");
        const until = denverLabel(issued.end);
        const lateDescription = `Late return fee for Order #${orderId}. The scheduled return of ${returnLabel} passed and the rental was still out.`;
        const { data: claimed } = await supabaseAdmin
          .from("bookings")
          .update({
            late_return_notice_at: now.toISOString(),
            late_return_algopin_at: now.toISOString(),
            status: "late_return",
            fees: {
              ...fees,
              late_return: {
                amount: lateFee,
                description: lateDescription,
                created_at: now.toISOString(),
              },
            },
            follow_up_resolution: {
              reason: "late_return",
              notes: lateDescription,
              closes_flag: false,
              updated_at: now.toISOString(),
            },
          })
          .eq("id", orderId)
          .is("late_return_notice_at", null)
          .select("id")
          .maybeSingle();
        if (!claimed) continue;

        const pinBlock = issued.pin
          ? `<div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
               <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Return code</p>
               <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${issued.pin}</p>
             </div>
             <p>This code works only until <strong>${until}</strong>. Have the trailer back, locked, and secured on our premises by then.</p>`
          : `<p>Please call us for a return code. The trailer still needs to be back, locked, and secured by <strong>${until}</strong>.</p>`;
        const html = shell(
          `Return time has passed — Order #${orderId}`,
          `<p>Hi ${name},</p>
           <p>The scheduled return time for Order #${orderId} was <strong>${returnLabel}</strong>. That time has passed, and the original lock code has expired.</p>
           <p>A late fee of <strong>${money(lateFee)}</strong> will be charged to the card on file. If you return the trailer during this return window, or extend the rental in the customer portal while the next day is still open, this late fee is the only additional charge.</p>
           ${pinBlock}
           <p>If the trailer and every rental item are not back, or the rental is not extended, by ${until}, failure-to-return charges apply.</p>
           <p style="text-align:center;margin:24px 0;"><a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">Extend in the customer portal</a></p>`,
        );
        const sms = issued.pin
          ? `U-Fill Dumpsters: Order #${orderId} missed its return time. Late fee ${money(lateFee)}. Return code ${issued.pin} works only until ${until}. Return or extend by then, or failure-to-return charges apply. ${portalUrl}`
          : `U-Fill Dumpsters: Order #${orderId} missed its return time. Late fee ${money(lateFee)}. Have it back by ${until} or extend in the portal. ${portalUrl}`;
        await notify(booking, `Return time has passed — Order #${orderId} — U-Fill Dumpsters`, html, sms);
        await portalMessage(
          booking,
          `Order #${orderId}: the scheduled return of ${returnLabel} has passed and the original lock code has expired. A late fee of ${money(lateFee)} will be charged. Your return code${issued.pin ? ` is ${issued.pin}` : ""} works only until ${until}. Return the trailer by then, or extend in the customer portal if the next day is open, and the late fee is the only additional charge. If it is not back or extended by ${until}, failure-to-return charges apply.`,
          "late_return",
        );
        results.push({ orderId, action: issued.pin ? "late_return_with_code" : "late_return_without_code" });
        continue;
      }

      const codeMs = new Date(booking.late_return_algopin_at || booking.late_return_notice_at).getTime();
      if (now.getTime() < codeMs + TWO_HOURS_MS) continue;

      const windowEnd = deadline && deadline.getTime() > now.getTime() + 60 * 60 * 1000
        ? deadline
        : new Date(now.getTime() + 60 * 60 * 1000);
      const issued = await issuePin(booking, now.toISOString(), windowEnd.toISOString(), "failure to return");
      const until = denverLabel(issued.end);

      const equipment = Array.isArray(booking.addons?.equipment) ? booking.addons.equipment : [];
      const equipmentIds = equipment
        .map((item: { equipment_id?: number; dbId?: number; id?: number }) => equipmentIdOf(item))
        .filter((id: number | null): id is number => id != null);
      const catalogRates: Record<number, number> = {};
      if (equipmentIds.length) {
        const { data: rateRows } = await supabaseAdmin
          .from("equipment")
          .select("id, additional_day_price, type")
          .in("id", equipmentIds);
        for (const row of rateRows || []) {
          if (row.type === "rental") catalogRates[Number(row.id)] = Number(row.additional_day_price || 0);
        }
      }
      const lines = failureLines(booking, catalogRates);
      const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
      const failureDescription = `Failure to return Order #${orderId}. Not back within two hours after the return time. Charges apply whether or not the equipment comes back. ${lines.map((line) => `${line.name} ${money(line.amount)}`).join("; ")}`;
      const { data: fresh } = await supabaseAdmin.from("bookings").select("fees").eq("id", orderId).maybeSingle();
      const freshFees = (fresh?.fees && typeof fresh.fees === "object") ? fresh.fees : fees;
      const { data: claimed } = await supabaseAdmin
        .from("bookings")
        .update({
          failure_to_return_notice_at: now.toISOString(),
          status: "failure_to_return",
          fees: {
            ...freshFees,
            failure_to_return: {
              amount: total,
              description: failureDescription,
              lines,
              created_at: now.toISOString(),
            },
          },
          follow_up_resolution: {
            reason: "failure_to_return",
            notes: failureDescription,
            closes_flag: false,
            updated_at: now.toISOString(),
          },
        })
        .eq("id", orderId)
        .is("failure_to_return_notice_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const lineHtml = lines.map((line) => `<li>${line.name}: ${money(line.amount)}</li>`).join("");
      const pinBlock = issued.pin
        ? `<div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
             <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Return code through 5:00 AM</p>
             <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${issued.pin}</p>
           </div>
           <p>This code is only for bringing the equipment back. It works until <strong>${until}</strong>.</p>`
        : `<p>Call us if you need a code to return the equipment. It must be locked on our premises by <strong>${deadlineLabel}</strong>.</p>`;
      const html = shell(
        `Failure to return equipment — Order #${orderId}`,
        `<p>Hi ${name},</p>
         <p>Order #${orderId} was not returned within the two hours after the scheduled return. Failure-to-return charges of <strong>${money(total)}</strong> have accrued and will be charged to the card on file. These charges apply whether or not the equipment is brought back.</p>
         <ul>${lineHtml}</ul>
         ${pinBlock}
         <p>The trailer and every rental item must be locked on our premises no later than <strong>${deadlineLabel}</strong>. If they are not, the unreturned equipment will be treated as stolen rental property.</p>
         <p>Holding this equipment also kept the next customer from the booking they reserved. That breaks the rental agreement, and you are responsible for that lost business. The account may be closed, and you may be banned from using U-Fill Dumpsters again.</p>`,
      );
      await notify(
        booking,
        `Failure to return equipment — Order #${orderId} — U-Fill Dumpsters`,
        html,
        `U-Fill Dumpsters: Order #${orderId} was not returned in time. Failure-to-return charges of ${money(total)} apply now. ${issued.pin ? `Return code ${issued.pin}. ` : ""}Have it locked on our premises by ${deadlineLabel} or it will be treated as stolen. You may be banned from future rentals.`,
      );
      await portalMessage(
        booking,
        `Order #${orderId}: the trailer was not back within two hours. Failure-to-return charges of ${money(total)} have accrued and will be charged whether or not the equipment comes back. ${issued.pin ? `Return code ${issued.pin} works until ${until}. ` : ""}Lock it on our premises no later than ${deadlineLabel}. After that it will be treated as stolen rental property. You may be banned from using U-Fill Dumpsters again.`,
        "failure_to_return",
      );
      results.push({ orderId, action: "failure_to_return", total });
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), { status: 200, headers });
  } catch (error) {
    console.error("[enforce-late-return]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers,
    });
  }
});
