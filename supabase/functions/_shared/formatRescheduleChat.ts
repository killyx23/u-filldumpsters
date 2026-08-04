import { formatPlainBookingTime } from "./formatBookingTime.ts";

function formatFriendlyDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "N/A") return null;
    if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(trimmed)) return trimmed;
    const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly) {
      const [y, m, d] = dateOnly[1].split("-").map(Number);
      const local = new Date(y, m - 1, d);
      if (!isNaN(local.getTime())) {
        return local.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return trimmed;
  }
  return String(value);
}

function formatFriendlyDateTime(dateValue: unknown, timeValue: unknown): string | null {
  const datePart = formatFriendlyDate(dateValue);
  const timePart = timeValue ? formatPlainBookingTime(String(timeValue)) : null;
  if (datePart && timePart && timePart !== "N/A") return `${datePart} at ${timePart}`;
  return datePart || (timePart !== "N/A" ? timePart : null) || null;
}

function formatAddonList(addons: unknown): string {
  if (!Array.isArray(addons) || addons.length === 0) return "None";
  return addons
    .map((a: Record<string, unknown>) => {
      const name = String(a?.name || "Add-on");
      const qty = Number(a?.quantity || 1);
      return `${name} (qty ${qty})`;
    })
    .join(", ");
}

function addonListsEqual(a: unknown, b: unknown): boolean {
  const normalize = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((item: Record<string, unknown>) => `${item?.id ?? item?.name ?? ""}:${Number(item?.quantity || 1)}`)
      .sort()
      .join("|");
  return normalize(a) === normalize(b);
}

export type RescheduleChatInput = {
  bookingId: string | number;
  originalBooking?: Record<string, unknown> | null;
  originalServiceName?: string | null;
  newServiceName?: string | null;
  newDropOffDate?: unknown;
  newPickupDate?: unknown;
  newDropOffTime?: unknown;
  newPickupTime?: unknown;
  originalAddons?: unknown;
  newAddons?: unknown;
  originalAddress?: string | null;
  newAddress?: string | null;
  addressChanged?: boolean;
  isManualAddress?: boolean;
  comments?: string | null;
};

/** Professional Direct Chat summary for a customer reschedule request. */
export function buildRescheduleRequestChatMessage(input: RescheduleChatInput): string {
  const bookingId = input.bookingId;
  const original = input.originalBooking || {};

  const lines = [
    `Reschedule request for Booking #${bookingId}`,
    "Status: Pending scheduling approval",
    "",
    "CURRENT SCHEDULE",
    `Drop-off: ${formatFriendlyDateTime(original.drop_off_date, original.drop_off_time_slot) || "N/A"}`,
    `Pickup:   ${formatFriendlyDateTime(original.pickup_date, original.pickup_time_slot) || "N/A"}`,
    "",
    "REQUESTED SCHEDULE",
    `Drop-off: ${formatFriendlyDateTime(input.newDropOffDate, input.newDropOffTime) || "N/A"}`,
    `Pickup:   ${formatFriendlyDateTime(input.newPickupDate, input.newPickupTime) || "N/A"}`,
  ];

  const fromService = input.originalServiceName || null;
  const toService = input.newServiceName || null;
  if (fromService && toService && fromService !== toService) {
    lines.push("", `Service: ${fromService} → ${toService}`);
  } else if (toService && !fromService) {
    lines.push("", `Service: ${toService}`);
  }

  if (input.addressChanged) {
    const fromAddr = (input.originalAddress || "").trim() || "N/A";
    const toAddr = (input.newAddress || "").trim() || "N/A";
    const toSuffix = input.isManualAddress ? " (needs address verification)" : "";
    lines.push("", "Delivery address:", `  From: ${fromAddr}`, `  To: ${toAddr}${toSuffix}`);
  }

  if (!addonListsEqual(input.originalAddons, input.newAddons)) {
    lines.push(
      "",
      `Add-ons: ${formatAddonList(input.originalAddons)} → ${formatAddonList(input.newAddons)}`,
    );
  }

  const trimmedComments = (input.comments || "").trim();
  if (trimmedComments) {
    lines.push("", `Comments: ${trimmedComments}`);
  }

  return lines.join("\n").trim();
}

export function buildRescheduleApprovedChatMessage(input: {
  bookingId: string | number;
  originalTotal: number;
  newTotal: number;
  delta: number;
  stripeType: "charge" | "refund" | "none";
  stripeTransactionId?: string | null;
  amountProcessed?: number;
}): string {
  const absDelta = Math.abs(Number(input.delta) || 0);
  const formatMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const lines = [
    `Reschedule approved for Booking #${input.bookingId}`,
    "Status: Confirmed — changes applied",
    "",
    `Original total: ${formatMoney(Number(input.originalTotal) || 0)}`,
    `New total: ${formatMoney(Number(input.newTotal) || 0)}`,
  ];

  if (input.stripeType === "charge" && absDelta > 0) {
    lines.push(
      `Card charged: ${formatMoney(input.amountProcessed ?? absDelta)}`,
    );
  } else if (input.stripeType === "refund" && absDelta > 0) {
    lines.push(
      `Refunded to card: ${formatMoney(input.amountProcessed ?? absDelta)}`,
    );
  } else {
    lines.push("No additional charge or refund.");
  }

  // Stripe transaction ids stay admin-only; never include in customer chat.

  return lines.join("\n").trim();
}
