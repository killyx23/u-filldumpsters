/**
 * Admin alerts for physical-security and connectivity events on rental locks.
 * Uses the same BREVO_FROM_EMAIL admin address as ensure-lock-pin-ready.
 */

import { sendEmail } from "./notify.ts";

function adminEmail(): string | null {
  return Deno.env.get("LOCK_ALERT_EMAIL") || Deno.env.get("BREVO_FROM_EMAIL") || null;
}

function wrap(title: string, color: string, rows: Array<[string, string]>, note: string): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;">${label}</td><td style="padding:6px 0;font-weight:600;">${value}</td></tr>`,
    )
    .join("");
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;">
      <h2 style="color:${color};margin:0 0 12px;">${title}</h2>
      <table style="border-collapse:collapse;font-size:14px;">${cells}</table>
      <p style="margin:16px 0 0;color:#475569;font-size:14px;">${note}</p>
    </div>
  `;
}

export async function alertBreakInAttempt(details: {
  deviceId: string;
  label?: string | null;
  occurredAt: string;
  orderId?: number | null;
}): Promise<void> {
  const to = adminEmail();
  if (!to) {
    console.error("[lockAlerts] No admin email configured; skipping break-in alert");
    return;
  }
  const html = wrap("Break-in attempt detected", "#b91c1c", [
    ["Lock", details.label || details.deviceId],
    ["Device ID", details.deviceId],
    ["Detected at", new Date(details.occurredAt).toLocaleString("en-US")],
    ["Booking", details.orderId ? `#${details.orderId}` : "Not matched to a booking"],
  ], "The lock reported a tamper / forced-entry attempt (log type 53). Check the equipment.");
  await sendEmail(to, `Break-in attempt on ${details.label || details.deviceId}`, html);
}

export async function alertBridgeOfflineWhileUnlocked(details: {
  bridgeId: string;
  deviceId: string;
  label?: string | null;
  lastStateChangedAt?: string | null;
}): Promise<void> {
  const to = adminEmail();
  if (!to) {
    console.error("[lockAlerts] No admin email configured; skipping bridge-offline alert");
    return;
  }
  const html = wrap("Lock left open and bridge went offline", "#c2410c", [
    ["Lock", details.label || details.deviceId],
    ["Bridge ID", details.bridgeId],
    [
      "Unlocked since",
      details.lastStateChangedAt
        ? new Date(details.lastStateChangedAt).toLocaleString("en-US")
        : "Unknown",
    ],
  ], "Connectivity was lost while the lock was still unlocked, so further activity will not be reported until the bridge reconnects.");
  await sendEmail(to, `Bridge offline with ${details.label || details.deviceId} unlocked`, html);
}
