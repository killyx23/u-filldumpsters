/**
 * Curbside mattress disposal reminders for delivery bookings only.
 * Illegal to mix mattresses with regular debris — must be sorted separately.
 */

import { isDeliveryBooking } from "./deliveryBooking.ts";

export const MATTRESS_CURBSIDE_RECEIPT_NOTE =
  "(Mattress reminder: Do not put mattresses or box springs in the dumpster. They must be separated and placed at the curbside only for curb pickup. We do not pick up from the porch, driveway, or inside the house.)";

export const MATTRESS_CURBSIDE_EMAIL_NOTE =
  "(Mattress reminder: Do not put mattresses or box springs in the dumpster. They must be separated and placed at the curbside only for curb pickup. We do not pick up from the porch, driveway, or inside the house.)";

export const MATTRESS_CURBSIDE_SMS_NOTE =
  "Do not put the mattress in the dumpster — keep it separated at the curbside so we can throw it in the truck. Curb only; not porch, driveway, or inside.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

export function bookingHasMattressDisposal(
  booking: Record<string, unknown> | null | undefined,
): boolean {
  if (!booking) return false;
  const addons = asRecord(booking.addons);
  return Number(addons.mattressDisposal || 0) > 0;
}

export function shouldShowMattressCurbsideReminder(
  booking: Record<string, unknown> | null | undefined,
): boolean {
  return bookingHasMattressDisposal(booking) && isDeliveryBooking(booking);
}

export function mattressCurbsideSms(orderId: number | string): string {
  return `U-Fill Dumpsters: Order #${orderId} — ${MATTRESS_CURBSIDE_SMS_NOTE}`;
}
