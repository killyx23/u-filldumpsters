/**
 * Parse booking time slots stored as 24h (HH:mm / HH:mm:ss) or 12h (h:mm a).
 */
export function parseBookingTimeToDate(timeString: string): Date | null {
  if (!timeString || typeof timeString !== "string") return null;
  const trimmed = timeString.trim();
  if (!trimmed) return null;

  const ref = new Date(2000, 0, 1);

  const try24WithSeconds = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (try24WithSeconds) {
    const d = new Date(ref);
    d.setHours(parseInt(try24WithSeconds[1], 10), parseInt(try24WithSeconds[2], 10), 0, 0);
    return d;
  }

  const try24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (try24 && !/\s*(AM|PM)/i.test(trimmed)) {
    const d = new Date(ref);
    d.setHours(parseInt(try24[1], 10), parseInt(try24[2], 10), 0, 0);
    return d;
  }

  const try12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(trimmed);
  if (try12) {
    let hours = parseInt(try12[1], 10);
    const minutes = parseInt(try12[2], 10);
    const meridiem = try12[3].toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    const d = new Date(ref);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  return null;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function parseDeliveryWindow(timeString: string): { start: Date; end: Date } | null {
  if (!timeString || typeof timeString !== "string") return null;
  const trimmed = timeString.trim();
  if (!trimmed) return null;

  if (trimmed.includes("|")) {
    const [startRaw, endRaw] = trimmed.split("|").map((t) => t.trim()).filter(Boolean);
    const start = parseBookingTimeToDate(startRaw);
    const end = parseBookingTimeToDate(endRaw);
    if (start && end) return { start, end };
    if (start) {
      const endFallback = new Date(start);
      endFallback.setHours(endFallback.getHours() + 2);
      return { start, end: endFallback };
    }
    return null;
  }

  const start = parseBookingTimeToDate(trimmed);
  if (!start) return null;
  const end = new Date(start);
  end.setHours(end.getHours() + 2);
  return { start, end };
}

export function formatBookingTime(
  timeString: string,
  options: { isSelfService?: boolean; isReturnBy?: boolean } = {},
): string {
  if (!timeString) return "N/A";

  if (typeof timeString === "string" && timeString.includes("|")) {
    const window = parseDeliveryWindow(timeString);
    if (window) return `${formatClock(window.start)} - ${formatClock(window.end)}`;
  }

  const parsed = parseBookingTimeToDate(timeString);
  if (!parsed) return timeString;

  const formatted = formatClock(parsed);

  if (options.isSelfService) {
    const hour24 = parsed.getHours();
    const minute = parsed.getMinutes();
    if (options.isReturnBy || hour24 >= 22 || (hour24 === 23 && minute === 0)) {
      return `by ${formatted}`;
    }
    if (hour24 <= 8 || (hour24 === 6 && minute === 0)) {
      return `after ${formatted}`;
    }
  }

  return formatted;
}

/** Delivery copy: "between 6:00 AM and 8:00 AM" (pipe range or 2-hour window from start). */
export function formatDeliveryTimeWindowBetween(timeString: string): string {
  const window = parseDeliveryWindow(timeString);
  if (!window) return timeString || "N/A";
  return `between ${formatClock(window.start)} and ${formatClock(window.end)}`;
}

/** 12-hour time only (no "after" / "by" prefix) for copy that already includes those words. */
export function formatPlainBookingTime(timeString: string): string {
  if (!timeString) return "N/A";
  if (typeof timeString === "string" && timeString.includes("|")) {
    const window = parseDeliveryWindow(timeString);
    if (window) return `${formatClock(window.start)} - ${formatClock(window.end)}`;
  }
  const parsed = parseBookingTimeToDate(timeString);
  if (!parsed) return timeString;
  return formatClock(parsed);
}
