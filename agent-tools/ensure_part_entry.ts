// Auto-split entry — imports side effects from shared
import "./shared.ts";
Deno.serve(async (req) => {
const corsHeaders = getCorsHeaders(req);
const jsonResponse = makeJsonResponse(corsHeaders);
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
try {
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";
const authHeader = req.headers.get("Authorization");
const incomingKey = authHeader?.replace("Bearer ", "").trim();
if (!incomingKey || incomingKey !== serviceRoleKey) {
return jsonResponse({ success: false, error: "Unauthorized" }, 401);
}
if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
return jsonResponse({ success: false, error: "Missing env" }, 500);
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
auth: { autoRefreshToken: false, persistSession: false },
});
const accessToken = await getOAuthTokenForWatchdog(clientId, clientSecret);
if (!accessToken) {
return jsonResponse({ success: false, error: "OAuth failed" }, 502);
}
const now = new Date();
const nowMs = now.getTime();
const horizonIso = new Date(nowMs + PIN_LEAD_TIME_MS).toISOString().slice(0, 10);
const today = now.toISOString().slice(0, 10);
const { data: bookings, error: fetchError } = await supabase
.from("bookings")
.select("*")
.eq("status", "Confirmed")
.gte("drop_off_date", today)
.lte("drop_off_date", horizonIso)
.order("drop_off_date", { ascending: true });
if (fetchError) {
return jsonResponse({ success: false, error: fetchError.message }, 500);
}
const candidates = (bookings || []).filter((b: Record<string, unknown>) => {
if (!isTrailerRental(b)) return false;
if (!isWithinPinGenerationWindow(b, now)) return false;
return true;
});
const results: Array<Record<string, unknown>> = [];
for (const booking of candidates) {
const orderId = Number(booking.id);
const window = getBookingWindow(booking);
const msToPickup = window.startMs - nowMs;
const underTwoHours = msToPickup <= TWO_HOURS_MS && msToPickup > -FINAL_HOUR_MS;
const { data: activePin } = await supabase
.from("rental_access_codes")
.select("*")
.eq("order_id", orderId)
.eq("status", "active")
.order("created_at", { ascending: false })
.limit(1)
.maybeSingle();
if (activePin?.lock_confirmed_at && activePin?.access_pin) {
if (!booking.pin_notification_sent_at) {
await maybeNotifyCustomer(
supabase,
booking,
String(activePin.access_pin),
String(activePin.start_time || window.activationIso),
String(activePin.end_time || window.graceEndIso),
);
}
results.push({ orderId, action: "skip_confirmed" });
continue;
}
if (activePin?.pin_id && activePin.pin_type === "bridge_proxied") {
const poll = await pollJob(accessToken, activePin.pin_id, 20_000, 2500);
if (poll.state === "completed") {
const nowIso = new Date().toISOString();
await supabase
.from("rental_access_codes")
.update({ lock_confirmed_at: nowIso })
.eq("id", activePin.id);
await maybeNotifyCustomer(
supabase,
booking,
String(activePin.access_pin),
String(activePin.start_time || window.activationIso),
String(activePin.end_time || window.graceEndIso),
);
results.push({ orderId, action: "confirmed_existing" });
continue;
}
}
const startDate = getPinActivationStart(booking);
const endDate = addGraceHour(
buildBookingDateUTC(booking.pickup_date, booking.pickup_time_slot, 5),
);
const attempts = (activePin?.confirm_attempts || 0) + 1;
const useAlgo = shouldUseAlgoPinFallback(activePin, attempts, nowMs, msToPickup);
if (useAlgo) {
const algo = await createAlgoPin(accessToken, lockId, booking);
if (algo.success) {
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const nowIso = new Date().toISOString();
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: algo.pin,
pin_id: algo.pinId,
pin_type: "algopin",
lock_id: lockId,
start_time: algo.startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: nowIso,
confirm_attempts: attempts,
});
if (insertError) {
console.error(`[ensure-lock-pin-ready] AlgoPIN insert failed #${orderId}:`, insertError.message);
await alertCustomerChat(
supabase,
booking,
`URGENT: Access PIN for Order #${orderId} could not be saved after AlgoPIN fallback (${insertError.message}). Staff must generate a PIN before pickup on ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}.`,
);
await alertAdmin(
`PIN save failed after AlgoPIN — Order #${orderId}`,
`<p>AlgoPIN was issued but DB insert failed: ${insertError.message}</p>`,
);
results.push({ orderId, action: "algopin_insert_failed", error: insertError.message });
continue;
}
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
const notes =
`AlgoPIN fallback issued for order #${orderId} — bridge never confirmed within retry budget. ` +
`PIN ${algo.pin} (single-use offline).`;
await logSyncError(supabase, orderId, notes);
await alertAdmin(
`AlgoPIN fallback — Order #${orderId}`,
`<h2>Bridge PIN failed — AlgoPIN issued</h2>
<p><strong>Order:</strong> #${orderId}</p>
<p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
<p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
<p><strong>AlgoPIN:</strong> ${algo.pin}</p>
<p>The bridge could not confirm the custom PIN within the retry window. An offline AlgoPIN was issued so the customer can still open the lock.</p>`,
);
results.push({ orderId, action: "algopin_fallback", pin: algo.pin });
continue;
}
const failMsg =
`URGENT: Access PIN has NOT been generated for Order #${orderId}. ` +
`Bridge retries exhausted and AlgoPIN fallback failed (${algo.error || "unknown"}). ` +
`Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
`Generate a PIN manually before the customer arrives.`;
await logSyncError(supabase, orderId, failMsg);
await alertCustomerChat(supabase, booking, failMsg);
await alertAdmin(
`PIN generation FAILED — Order #${orderId}`,
`<h2>No access PIN available</h2>
<p><strong>Order:</strong> #${orderId}</p>
<p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
<p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
<p><strong>AlgoPIN error:</strong> ${algo.error || "unknown"}</p>
<p>Manual intervention required.</p>`,
);
results.push({ orderId, action: "failed_alerted", error: algo.error });
continue;
}
const ensured = await ensurePinOnLock(supabase, accessToken, {
orderId,
lockId,
bridgeId,
startDate,
endDate,
accessName: `Dump Loader Rental - Order #${orderId}`,
clearBudgetMs: 40_000,
createBudgetMs: 50_000,
});
const nowIso = new Date().toISOString();
if (!ensured.jobId && !ensured.lockConfirmed) {
const algo = await createAlgoPin(accessToken, lockId, booking);
if (algo.success) {
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: algo.pin,
pin_id: algo.pinId,
pin_type: "algopin",
lock_id: lockId,
start_time: algo.startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: nowIso,
confirm_attempts: attempts,
});
if (!insertError) {
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
await logSyncError(
supabase,
orderId,
`AlgoPIN issued after hard bridge failure for #${orderId}: ${ensured.error || ensured.createState}`,
);
results.push({ orderId, action: "algopin_hard_fail_fallback", pin: algo.pin });
continue;
}
}
}
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: ensured.pin,
pin_id: ensured.jobId || "",
pin_type: "bridge_proxied",
lock_id: lockId,
start_time: startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: ensured.lockConfirmed ? nowIso : null,
confirm_attempts: attempts,
});
if (insertError) {
console.error(`[ensure-lock-pin-ready] Bridge PIN insert failed #${orderId}:`, insertError.message);
await logSyncError(supabase, orderId, `Bridge PIN insert failed: ${insertError.message}`);
if (underTwoHours || attempts >= ALERT_ATTEMPTS_THRESHOLD) {
await alertCustomerChat(
supabase,
booking,
`URGENT: Access PIN for Order #${orderId} was queued on the lock but failed to save in the portal (${insertError.message}). Staff must verify/generate before pickup.`,
);
await alertAdmin(
`PIN DB insert failed — Order #${orderId}`,
`<p>Insert failed: ${insertError.message}</p>`,
);
}
results.push({ orderId, action: "insert_failed", error: insertError.message });
continue;
}
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
if (ensured.lockConfirmed) {
await maybeNotifyCustomer(supabase, booking, ensured.pin, startDate, endDate);
results.push({ orderId, action: "created_confirmed", pin: ensured.pin });
} else {
await logSyncError(
supabase,
orderId,
`Bridge PIN not confirmed (attempt ${attempts}): ${ensured.error || ensured.createState}. jobId=${ensured.jobId}`,
);
if (attempts >= ALERT_ATTEMPTS_THRESHOLD || underTwoHours) {
const msg =
`Access PIN for Order #${orderId} is not confirmed on the lock yet ` +
`(attempt ${attempts}). Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
`Watchdog will retry / issue AlgoPIN backup. Job: ${ensured.jobId || "n/a"}.`;
await alertCustomerChat(supabase, booking, msg);
await alertAdmin(
`PIN not confirmed on lock — Order #${orderId}`,
`<h2>Bridge has not confirmed PIN delivery</h2>
<p><strong>Order:</strong> #${orderId}</p>
<p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
<p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
<p><strong>Job ID:</strong> ${ensured.jobId || "n/a"}</p>
<p><strong>Attempts:</strong> ${attempts}</p>
<p><strong>State:</strong> ${ensured.createState}</p>
<p>Wake the padlock / check bridge range. Watchdog will retry; AlgoPIN backup fires after the retry budget.</p>`,
);
}
results.push({
orderId,
action: "created_unconfirmed",
pin: ensured.pin,
jobId: ensured.jobId,
attempts,
});
}
}
return jsonResponse({
success: true,
processed: results.length,
results,
});
} catch (error) {
console.error("[ensure-lock-pin-ready]", error);
return jsonResponse({
success: false,
error: error instanceof Error ? error.message : String(error),
}, 500);
}
});
