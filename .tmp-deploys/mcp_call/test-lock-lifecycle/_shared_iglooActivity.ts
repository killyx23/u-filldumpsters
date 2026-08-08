/**
 * Flexible parsers for Igloohome bridge activity-log payloads.
 * Field names vary across API versions — probe mode logs the raw shape.
 */

export type LockActivityEvent = {
  eventType: "unlock" | "lock";
  eventTimestamp: string;
  pinCode: string | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  return null;
}

function normalizeEventType(raw: string | null): "unlock" | "lock" | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (
    lower.includes("unlock") ||
    lower === "open" ||
    lower === "unlocked" ||
    lower === "pinunlock" ||
    lower === "accessgranted"
  ) {
    return "unlock";
  }
  if (
    lower.includes("lock") ||
    lower === "close" ||
    lower === "locked" ||
    lower === "relock" ||
    lower === "autolock"
  ) {
    // "unlock" already matched above; bare "lock" / "relock"
    if (lower.includes("unlock")) return "unlock";
    return "lock";
  }
  return null;
}

function extractTimestamp(entry: Record<string, unknown>): string | null {
  const raw = pickString(entry, [
    "timestamp",
    "eventTimestamp",
    "event_timestamp",
    "time",
    "date",
    "createdAt",
    "created_at",
    "lockTime",
    "activityTime",
  ]);
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function extractPin(entry: Record<string, unknown>): string | null {
  return pickString(entry, [
    "pin",
    "pinCode",
    "pin_code",
    "accessCode",
    "access_code",
    "code",
    "pinValue",
  ]);
}

function extractTypeRaw(entry: Record<string, unknown>): string | null {
  const typeVal = entry.type ?? entry.eventType ?? entry.event_type ?? entry.action ??
    entry.activityType ?? entry.activity_type ?? entry.operation ?? entry.op;
  if (typeof typeVal === "number") {
    // Common numeric mappings seen in lock vendors: unlock-ish vs lock-ish
    // We treat odd/even heuristically only as last resort via string path.
    return String(typeVal);
  }
  if (typeof typeVal === "string") return typeVal;
  return null;
}

/** Parse a single activity log entry into a normalized event, or null if unusable. */
export function parseActivityLogEntry(entry: unknown): LockActivityEvent | null {
  const obj = asRecord(entry);
  if (!obj) return null;

  // Nested data wrappers
  const nested = asRecord(obj.data) || asRecord(obj.event) || asRecord(obj.activity) || obj;
  const eventType = normalizeEventType(extractTypeRaw(nested) || extractTypeRaw(obj));
  const eventTimestamp = extractTimestamp(nested) || extractTimestamp(obj);
  if (!eventType || !eventTimestamp) return null;

  return {
    eventType,
    eventTimestamp,
    pinCode: extractPin(nested) || extractPin(obj),
    raw: obj,
  };
}

/**
 * Walk a job response / webhook body and collect activity log arrays from
 * common nesting locations.
 */
export function extractActivityLogArrays(payload: unknown): unknown[][] {
  const arrays: unknown[][] = [];
  const root = asRecord(payload);
  if (!root) return arrays;

  const candidates = [
    root.activityLogs,
    root.activity_logs,
    root.logs,
    root.events,
    root.history,
    root.payload,
    asRecord(root.jobResponse)?.activityLogs,
    asRecord(root.jobResponse)?.activity_logs,
    asRecord(root.jobResponse)?.logs,
    asRecord(root.jobResponse)?.events,
    asRecord(asRecord(root.jobResponse)?.opResult || {})?.activityLogs,
    asRecord(asRecord(root.jobResponse)?.opResult || {})?.logs,
    asRecord(root.event)?.data,
    asRecord(asRecord(root.event)?.data || {})?.activityLogs,
    asRecord(asRecord(root.event)?.data || {})?.logs,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) arrays.push(c);
    else if (asRecord(c) && Array.isArray((c as Record<string, unknown>).logs)) {
      arrays.push((c as Record<string, unknown>).logs as unknown[]);
    }
  }

  // Deep scan one level for any array of objects that look like log entries
  if (arrays.length === 0) {
    for (const value of Object.values(root)) {
      if (Array.isArray(value) && value.length > 0 && asRecord(value[0])) {
        arrays.push(value);
      }
      const nested = asRecord(value);
      if (nested) {
        for (const inner of Object.values(nested)) {
          if (Array.isArray(inner) && inner.length > 0 && asRecord(inner[0])) {
            arrays.push(inner);
          }
        }
      }
    }
  }

  return arrays;
}

export function parseActivityLogsFromPayload(payload: unknown): LockActivityEvent[] {
  const events: LockActivityEvent[] = [];
  const seen = new Set<string>();
  for (const arr of extractActivityLogArrays(payload)) {
    for (const entry of arr) {
      const parsed = parseActivityLogEntry(entry);
      if (!parsed) continue;
      const key = `${parsed.eventType}|${parsed.eventTimestamp}|${parsed.pinCode || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(parsed);
    }
  }
  // Also try treating the payload itself as a single event (webhook)
  const single = parseActivityLogEntry(payload) ||
    parseActivityLogEntry(asRecord(payload)?.event) ||
    parseActivityLogEntry(asRecord(asRecord(payload)?.event || {})?.data);
  if (single) {
    const key = `${single.eventType}|${single.eventTimestamp}|${single.pinCode || ""}`;
    if (!seen.has(key)) events.push(single);
  }
  return events.sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );
}
