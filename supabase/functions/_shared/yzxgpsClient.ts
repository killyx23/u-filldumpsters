/**
 * yzxgps GetDataService client from captured portal calls.
 * Credentials and request URLs are never logged.
 */

import { extractLoginSession, extractRows } from "./gpsGeofence.ts";

export const YZXGPS_BASE = "http://yzxgps.com/GetDataService.aspx";
export const YZXGPS_MAP_TYPE = "GOOGLECN";

export type YzxSession = { mds: string; id: string };

export type YzxResult = {
  errorCode: string;
  errorDescribe: string;
  success: boolean;
  body: unknown;
};

export type CircularFence = {
  id: string;
  macid: string;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  radiusMeters: number;
  status: number | null;
};

function parsePayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const jsonp = trimmed.match(/^[A-Za-z_][\w.]*\(([\s\S]*)\)\s*;?\s*$/);
  const raw = jsonp ? jsonp[1] : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function yzxGet(params: Record<string, string>): Promise<YzxResult> {
  const url = new URL(YZXGPS_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString());
  const text = await res.text();
  const body = parsePayload(text);
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const errorCode = String(record.errorCode ?? "");
  const errorDescribe = String(record.errorDescribe ?? record.msg ?? "");
  const success = record.success === true || record.success === "true" || errorCode === "200";
  return { errorCode, errorDescribe, success, body };
}

export function isLoginFailure(result: YzxResult): boolean {
  return !result.success ||
    result.errorCode === "403" ||
    result.errorCode === "404" ||
    result.errorDescribe.includes("用户名或密码错误");
}

export function isSessionFailure(result: YzxResult): boolean {
  return result.errorCode === "403" || result.errorDescribe.toLowerCase().includes("mds");
}

export async function userLogin(userName: string, password: string): Promise<
  | { ok: true; session: YzxSession }
  | { ok: false; authFailed: boolean; detail: string }
> {
  const result = await yzxGet({
    method: "SignApi",
    w: "UserLogin",
    userName,
    password,
    language: "en",
    timeZone: "-7",
    apply: "APP",
  });
  if (isLoginFailure(result)) {
    return {
      ok: false,
      authFailed: true,
      detail: result.errorDescribe || `Login failed with errorCode ${result.errorCode || "unknown"}.`,
    };
  }
  const session = extractLoginSession(result.body);
  if (!session) {
    return {
      ok: false,
      authFailed: false,
      detail: "Login succeeded but the response did not include mds and id.",
    };
  }
  return { ok: true, session };
}

export async function locationByUser(session: YzxSession): Promise<YzxResult> {
  return await yzxGet({
    method: "QueryApi",
    w: "LocationByUser",
    mds: session.mds,
    id: session.id,
    mapType: YZXGPS_MAP_TYPE,
  });
}

/** Portal call: method=CircularFenceGetList&MacId=&MapType=&mds=&id= */
export async function circularFenceGetList(session: YzxSession, macid: string): Promise<YzxResult> {
  return await yzxGet({
    method: "CircularFenceGetList",
    MacId: macid,
    MapType: YZXGPS_MAP_TYPE,
    mapType: YZXGPS_MAP_TYPE,
    mds: session.mds,
    id: session.id,
  });
}

function fenceNameParts(raw: unknown): { name: string; address: string | null } {
  const full = String(raw ?? "").trim();
  if (!full) return { name: "Yard", address: null };
  const split = full.split("|_|,");
  if (split.length >= 2) {
    return {
      name: split[0].trim() || "Yard",
      address: split.slice(1).join("|_|,").trim() || null,
    };
  }
  return { name: full, address: null };
}

export function parseCircularFences(body: unknown, fallbackMacid: string): CircularFence[] {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const data = record?.data;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown> | null)?.rows)
    ? (data as Record<string, unknown>).rows as unknown[]
    : [];
  const fences: CircularFence[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const lat = Number(item.Lat ?? item.lat);
    const lon = Number(item.Lng ?? item.Lon ?? item.lon);
    const radius = Number(item.Radius ?? item.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radius > 0)) continue;
    const parts = fenceNameParts(item.FenceName ?? item.fenceName);
    fences.push({
      id: String(item.Id ?? item.id ?? "").trim(),
      macid: String(item.MacId ?? item.macid ?? fallbackMacid).trim() || fallbackMacid,
      name: parts.name,
      address: parts.address,
      lat,
      lon,
      radiusMeters: Math.round(radius),
      status: Number.isFinite(Number(item.Status ?? item.status)) ? Number(item.Status ?? item.status) : null,
    });
  }
  return fences;
}

/** Same lat/lon/radius counted once; the portal currently repeats the same circle. */
export function uniqueFenceCircles(fences: CircularFence[]): CircularFence[] {
  const seen = new Set<string>();
  const unique: CircularFence[] = [];
  for (const fence of fences) {
    const key = `${fence.lat.toFixed(6)}:${fence.lon.toFixed(6)}:${fence.radiusMeters}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fence);
  }
  return unique;
}

export function locationRows(result: YzxResult): Record<string, unknown>[] {
  return extractRows(result.body);
}

/** Same alarm types the VitalGlow Alarms page requests. 3 = leave fence, 4 = enter fence. */
export const ALARM_TYPES = "1,3,4,5,6,8,16,17,82,93";
export const ALARM_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const ALARM_LEAVE = 3;
export const ALARM_ENTER = 4;
export const ALARM_LABELS: Record<number, string> = {
  1: "SOS",
  3: "Leave fence",
  4: "Enter fence",
  5: "Device removal",
  6: "Overspeed",
  8: "Low power",
  16: "Vehicle started",
  17: "Collision",
  82: "Vehicle shutdown",
  93: "Vehicle started",
};

export type VendorAlarm = {
  id: string;
  macid: string;
  objectid: string | null;
  classify: number;
  ptimeMs: number | null;
  ptimeRaw: string | null;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  notea: string;
  status: number | null;
};

/** Portal stores ptime as China wall time. */
export function parseVendorPtime(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/);
  if (match) {
    const iso =
      `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` +
      `T${match[4].padStart(2, "0")}:${match[5]}:${match[6]}+08:00`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** Portal call: method=alarmOperation&alarmType=&enterprise_id=&userid=&beginTime=&endTime= */
export async function alarmOperation(
  session: YzxSession,
  objectid: string,
  beginTimeMs: number,
  endTimeMs: number,
): Promise<YzxResult> {
  return await yzxGet({
    method: "alarmOperation",
    alarmType: ALARM_TYPES,
    enterprise_id: session.id,
    userid: objectid,
    beginTime: String(beginTimeMs),
    endTime: String(endTimeMs),
    mds: session.mds,
    id: session.id,
    mapType: YZXGPS_MAP_TYPE,
  });
}

export function parseVendorAlarms(body: unknown, fallbackMacid: string): VendorAlarm[] {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const data = record?.data;
  const rows = Array.isArray(data) ? data : [];
  const alarms: VendorAlarm[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    if (!id) continue;
    const classify = Number(item.classify);
    alarms.push({
      id,
      macid: String(item.macid ?? item.MacId ?? fallbackMacid).trim() || fallbackMacid,
      objectid: item.userid != null ? String(item.userid) : null,
      classify: Number.isFinite(classify) ? classify : -1,
      ptimeMs: parseVendorPtime(item.ptime ?? item.addtime),
      ptimeRaw: item.ptime != null ? String(item.ptime) : null,
      lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
      lon: Number.isFinite(Number(item.lon)) ? Number(item.lon) : null,
      speed: Number.isFinite(Number(item.speed)) ? Number(item.speed) : null,
      notea: String(item.Notea ?? item.notea ?? ""),
      status: Number.isFinite(Number(item.status)) ? Number(item.status) : null,
    });
  }
  return alarms;
}
