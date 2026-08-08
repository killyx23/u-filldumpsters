/**
 * Flexible parsers for Igloohome activity payloads.
 *
 * Bridge jobType 15 (GET_LOGS) often completes with only `opResult: { result: 0 }`
 * (operation success) and no log array. Real history is on:
 *   GET /igloohome/devices/{deviceId}/activity
 * after the Bridge pull uploads logs to the cloud.
 */

export const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

export type LockEventKind = "unlock" | "lock" | "breakin";

export type LockActivityEvent = {
  eventType: LockEventKind;
  eventTimestamp: string;
  pinCode: string | null;
  logType: number | null;
  keyId: string | null;
  operationId: string | null;
  deviceId: string | null;
  raw: Record<string, unknown>;
};

/**
 * Numeric activity log codes from the igloohome webhook (event type 5).
 * These arrive as `logType` on each entry in `activityLogs[]`.
 */
export const LOCK_LOG_TYPES = new Set([
  37, // Bluetooth lock
  49, // lock via keypad/button
  51, // lock with key/thumbturn
]);

export const UNLOCK_LOG_TYPES = new Set([
  11, // Bluetooth unlock
  18,
  19,
  20, // one-time PIN
  21,
  22,
  23,
  24,
  25,
  26, // unlock with the various PIN types
  50, // unlock via button
  52, // unlock with key/thumbturn
  56, // fingerprint unlock
]);

export const BREAKIN_LOG_TYPE = 53;

/** Map a numeric igloohome logType to an event kind, or null if not access-related. */
export function logTypeToEventKind(logType: unknown): LockEventKind | null {
  const n = typeof logType === "number"
    ? logType
    : typeof logType === "string" && /^\d+$/.test(logType.trim())
    ? Number(logType.trim())
    : null;
  if (n === null) return null;
  if (n === BREAKIN_LOG_TYPE) return "breakin";
  if (UNLOCK_LOG_TYPES.has(n)) return "unlock";
  if (LOCK_LOG_TYPES.has(n)) return "lock";
  return null;
}

function extractLogType(entry: Record<string, unknown>): number | null {
  const val = entry.logType ?? entry.log_type;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && /^\d+$/.test(val.trim())) return Number(val.trim());
  return null;
}

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

function isFailedActivity(raw: string | null, entry: Record<string, unknown>): boolean {
  const lower = (raw || "").toLowerCase();
  if (lower.includes("fail") || lower.includes("denied") || lower.includes("invalid")) {
    return true;
  }
  const desc = String(entry.description || "").toLowerCase();
  if (desc.includes("fail") || desc.includes("denied")) return true;
  return false;
}

function normalizeEventType(raw: string | null): LockEventKind | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, "");
  // Ignore non-access noise (time sync, battery, etc.)
  if (
    lower.includes("settime") ||
    lower.includes("battery") ||
    lower.includes("bluetooth") ||
    lower.includes("firmware") ||
    lower.includes("heartbeat")
  ) {
    return null;
  }
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
    lower.includes("relock") ||
    lower.includes("autolock") ||
    lower === "lock" ||
    lower === "close" ||
    lower === "locked" ||
    lower.includes("manualock") ||
    lower.includes("manuallock") ||
    (lower.includes("lock") && !lower.includes("unlock") && !lower.includes("block"))
  ) {
    return "lock";
  }
  return null;
}

/**
 * Webhook activity entries carry `entryDate` as epoch seconds. That is the
 * authoritative time the event happened at the lock — logs can be batched and
 * delivered long after the fact, so never fall back to delivery time.
 */
function extractEpochTimestamp(entry: Record<string, unknown>): string | null {
  for (const key of ["entryDate", "entry_date", "eventDate", "logDate"]) {
    const val = entry[key];
    let num: number | null = null;
    if (typeof val === "number" && Number.isFinite(val)) num = val;
    else if (typeof val === "string" && /^\d{9,13}$/.test(val.trim())) num = Number(val.trim());
    if (num === null || num <= 0) continue;
    // Values below ~1e11 are seconds; above that they are already milliseconds.
    const ms = num < 1e11 ? num * 1000 : num;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function extractTimestamp(entry: Record<string, unknown>): string | null {
  const epoch = extractEpochTimestamp(entry);
  if (epoch) return epoch;
  const raw = pickString(entry, [
    "localActionAt",
    "activityTimeAt",
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
  const direct = pickString(entry, [
    "pin",
    "pinCode",
    "pin_code",
    "accessCode",
    "access_code",
    "code",
    "pinValue",
  ]);
  if (direct) return direct;
  const extra = asRecord(entry.extra);
  if (extra) {
    return pickString(extra, ["pin", "pinCode", "pin_code", "accessCode", "code"]);
  }
  return null;
}

function extractTypeRaw(entry: Record<string, unknown>): string | null {
  const typeVal = entry.activityType ?? entry.activity_type ?? entry.type ??
    entry.eventType ?? entry.event_type ?? entry.action ?? entry.operation ?? entry.op ??
    entry.logType;
  if (typeof typeVal === "number") {
    return String(typeVal);
  }
  if (typeof typeVal === "string") return typeVal;
  return null;
}

/** Parse a failed PIN attempt for diagnostics (not applied to rental state). */
export function parseFailedPinAttempt(entry: unknown): {
  eventTimestamp: string;
  pinCode: string | null;
  activityType: string;
} | null {
  const obj = asRecord(entry);
  if (!obj) return null;
  const typeRaw = extractTypeRaw(obj);
  if (!isFailedActivity(typeRaw, obj)) return null;
  const lower = (typeRaw || "").toLowerCase();
  if (!lower.includes("unlock") && !lower.includes("pin")) return null;
  const eventTimestamp = extractTimestamp(obj);
  if (!eventTimestamp) return null;
  return {
    eventTimestamp,
    pinCode: extractPin(obj),
    activityType: typeRaw || "PIN_UNLOCK_FAILED",
  };
}

/** Parse a single activity log entry into a normalized event, or null if unusable. */
export function parseActivityLogEntry(entry: unknown): LockActivityEvent | null {
  const obj = asRecord(entry);
  if (!obj) return null;

  // Nested data wrappers
  const nested = asRecord(obj.data) || asRecord(obj.event) || asRecord(obj.activity) || obj;
  const logType = extractLogType(nested) ?? extractLogType(obj);
  const eventTimestamp = extractTimestamp(nested) || extractTimestamp(obj);
  if (!eventTimestamp) return null;

  // Numeric logType is authoritative when present — the webhook sends codes,
  // not descriptive strings, so this must win over the text heuristics below.
  let eventType = logTypeToEventKind(logType);
  if (!eventType) {
    if (logType !== null) return null;
    const typeRaw = extractTypeRaw(nested) || extractTypeRaw(obj);
    if (isFailedActivity(typeRaw, nested) || isFailedActivity(typeRaw, obj)) return null;
    eventType = normalizeEventType(typeRaw);
  }
  if (!eventType) return null;

  return {
    eventType,
    eventTimestamp,
    pinCode: extractPin(nested) || extractPin(obj),
    logType,
    keyId: pickString(nested, ["keyId", "key_id"]) || pickString(obj, ["keyId", "key_id"]),
    operationId: pickString(nested, ["operationId", "operation_id"]) ||
      pickString(obj, ["operationId", "operation_id"]),
    deviceId: pickString(nested, ["deviceId", "device_id", "lockId", "productId"]) ||
      pickString(obj, ["deviceId", "device_id", "lockId", "productId"]),
    raw: obj,
  };
}

/** Strip PIN material so raw payloads can be persisted or logged safely. */
export function redactPins(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPins);
  const obj = asRecord(value);
  if (!obj) return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (/^(pin|newpin|oldpin|pincode|pin_code|accesscode|access_code|code)$/i.test(key)) {
      out[key] = val ? "[redacted]" : val;
      continue;
    }
    out[key] = redactPins(val);
  }
  return out;
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

/** Merge and dedupe events from multiple sources (job payload + REST activity rows). */
export function eventsFromSource(source: unknown): LockActivityEvent[] {
  if (Array.isArray(source)) {
    if (source.length === 0) return [];
    const first = asRecord(source[0]);
    // Already-normalized LockActivityEvent[]
    if (
      first &&
      (first.eventType === "unlock" || first.eventType === "lock" ||
        first.eventType === "breakin") &&
      typeof first.eventTimestamp === "string"
    ) {
      return source as LockActivityEvent[];
    }
    // Raw GET /devices/.../activity payload rows
    const events: LockActivityEvent[] = [];
    const seen = new Set<string>();
    for (const entry of source) {
      const parsed = parseActivityLogEntry(entry);
      if (!parsed) continue;
      const key = `${parsed.eventType}|${parsed.eventTimestamp}|${parsed.pinCode || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(parsed);
    }
    return events;
  }
  return parseActivityLogsFromPayload(source);
}

export function mergeActivityEvents(
  ...sources: Array<LockActivityEvent[] | unknown>
): LockActivityEvent[] {
  const events: LockActivityEvent[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const parsed of eventsFromSource(source)) {
      const key = `${parsed.eventType}|${parsed.eventTimestamp}|${parsed.pinCode || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(parsed);
    }
  }
  return events.sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );
}

/**
 * True when Igloohome completed GET_LOGS but returned no log array —
 * commonly `jobResponse.opResult = { result: 0 }` (success with empty body).
 * Prefer reading GET /devices/{id}/activity after the job completes.
 */
export function isEmptyActivityLogPayload(payload: unknown): boolean {
  if (parseActivityLogsFromPayload(payload).length > 0) return false;
  const root = asRecord(payload);
  const jobResponse = asRecord(root?.jobResponse);
  const opResult = asRecord(jobResponse?.opResult);
  if (!opResult) return true;
  const result = opResult.result;
  if (result === 0 || result === "0" || result === null || result === undefined) {
    return true;
  }
  if (Array.isArray(result) && result.length === 0) return true;
  if (asRecord(result)) {
    const nested = asRecord(result);
    for (const key of ["activityLogs", "activity_logs", "logs", "events", "history"]) {
      const arr = nested?.[key];
      if (Array.isArray(arr) && arr.length > 0) return false;
    }
  }
  return extractActivityLogArrays(payload).every((a) => a.length === 0);
}

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

/**
 * Read stored device activity from Igloohome cloud.
 * Requires an access token issued with ONLY igloohomeapi/get-device-activity.
 */
export async function fetchDeviceActivityRows(
  accessToken: string,
  deviceId: string,
  opts: { maxPages?: number; pageSize?: number } = {},
): Promise<{ rows: unknown[]; error?: string; status?: number }> {
  const maxPages = opts.maxPages ?? 5;
  const pageSize = opts.pageSize ?? 50;
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) qs.set("cursor", cursor);
    const url = `${IGLOOHOME_API_BASE_URL}/devices/${deviceId}/activity?${qs}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
    } catch (err) {
      return { rows, error: `network error fetching device activity: ${err}` };
    }
    const body = await readResponse(res);
    if (!res.ok) {
      return {
        rows,
        error: `GET /devices/.../activity HTTP ${res.status}: ${
          String(body.json?.message || body.json?.error || body.text || "").slice(0, 300)
        }`,
        status: res.status,
      };
    }
    const chunk = Array.isArray(body.json?.payload)
      ? body.json.payload
      : Array.isArray(body.json)
      ? body.json
      : [];
    rows.push(...chunk);
    cursor = typeof body.json?.nextCursor === "string" && body.json.nextCursor
      ? body.json.nextCursor
      : null;
    if (!cursor || chunk.length === 0) break;
  }

  return { rows };
}
