/** Yard circle math and yzxgps row parsing. No network and no secrets. */

export const GPS_STREAK = 3;
export const GPS_STALE_MS = 10 * 60 * 1000;
export const GPS_SILENT_MS = 30 * 60 * 1000;
export const GPS_FRESH_MS = 15 * 60 * 1000;
export const CHECKOUT_LEAD_MS = 2 * 60 * 60 * 1000;
/** Cell-tower positioning. Too coarse to cross a yard line. */
export const CELL_POSITION_MODE = 16;

export type YardCircle = {
  lat: number;
  lon: number;
  radius_meters: number;
};

export type ParsedFix = {
  macid: string;
  fullName: string | null;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  gpstimeMs: number | null;
  hearttimeMs: number | null;
  serverTimeMs: number | null;
  deviceStatus: string | null;
  mileage: number | null;
  fuel: string | null;
  positioningMode: number | null;
  acc: boolean | null;
  mainPower: boolean | null;
  operatingStatus: string | null;
  valid: boolean;
  stale: boolean;
};

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function insideAnyYard(lat: number, lon: number, yards: YardCircle[]): boolean {
  return yards.some((yard) =>
    distanceMeters(lat, lon, yard.lat, yard.lon) <= yard.radius_meters
  );
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitDeviceValues(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(",");
}

export function parseTrackerRow(row: Record<string, unknown>, nowMs: number): ParsedFix | null {
  const macid = String(row.macid ?? row.macId ?? "").trim();
  if (!macid) return null;

  const values = splitDeviceValues(row.device_values);
  const positioningMode = num(values[15]);
  const mileage = num(values[0]);
  const fuelRaw = values[1];
  const fuel = fuelRaw == null ? null : String(fuelRaw).trim() || null;
  const operatingStatus = values[18] != null ? String(values[18]).trim() || null : null;
  const status = typeof row.device_status === "string" ? row.device_status : null;
  const bit = (index: number): boolean | null => {
    if (!status || status.length <= index) return null;
    if (status[index] === "1") return true;
    if (status[index] === "0") return false;
    return null;
  };

  const lat = num(row.lat);
  const lon = num(row.lon);
  const gpstimeMs = num(row.gpstime);
  const hearttimeMs = num(row.hearttime);
  const serverTimeMs = num(row.server_time) ?? nowMs;
  const noFix = lat == null || lon == null || (lat === 0 && lon === 0) || gpstimeMs == null || gpstimeMs === 0;
  const cell = positioningMode === CELL_POSITION_MODE;
  const stale = gpstimeMs != null && gpstimeMs > 0 && serverTimeMs - gpstimeMs > GPS_STALE_MS;
  const valid = !noFix && !cell && !stale;

  return {
    macid,
    fullName: row.fullName != null ? String(row.fullName) : null,
    lat,
    lon,
    speed: num(row.speed),
    gpstimeMs,
    hearttimeMs,
    serverTimeMs,
    deviceStatus: status,
    mileage,
    fuel,
    positioningMode,
    acc: bit(0),
    mainPower: bit(6),
    operatingStatus,
    valid,
    stale,
  };
}

export function extractRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = (data as Record<string, unknown>).rows;
    if (Array.isArray(rows)) return rows.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  if (Array.isArray(data)) return data.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (Array.isArray(record.rows)) {
    return record.rows.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  return [];
}

/** Account id from a login response or device list. Not a device macid. */
export function extractAccountId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null;
  const candidates = [record.id, data?.id, data?.userId, data?.userid, record.userId];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith("00000000-0000-0000-0000")) continue;
    return trimmed;
  }
  return null;
}

/** Session token and account id from UserLogin. Field names come from the live response. */
export function extractLoginSession(body: unknown): { mds: string; id: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null;
  const mdsRaw = data?.mds ?? record.mds;
  const idRaw = data?.id ?? record.id;
  const mds = typeof mdsRaw === "string" ? mdsRaw.trim() : "";
  const id = typeof idRaw === "string"
    ? idRaw.trim()
    : typeof idRaw === "number" && Number.isFinite(idRaw)
    ? String(idRaw)
    : "";
  if (!mds || !id || id.startsWith("00000000-0000-0000-0000")) return null;
  return { mds, id };
}

export function isoFromMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}
