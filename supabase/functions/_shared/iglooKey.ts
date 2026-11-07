/**
 * iglooKey Access API (shareable Bluetooth unlock link).
 * Host is api.igloohome.co — not the developer job API.
 */

import { getOAuthToken, requestOAuthToken, type OAuthResult } from "./iglooAuth.ts";

export const IGLOOHOME_HOME_API_BASE = "https://api.igloohome.co/home";
export const IGLOOKEY_OFFLINE_ACCESS_SECONDS = 24 * 60 * 60;

export type IglooKeyToken = {
  id: string;
  shareableUrl: string;
  startsAt?: string | null;
  endsAt?: string | null;
  activationDeadline?: string | null;
  type?: string | null;
};

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

function errorMessage(body: { json: unknown; text: string }, fallback: string): string {
  const json = body.json as Record<string, unknown> | null;
  if (json && typeof json === "object") {
    const message = json.message ?? json.error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const text = String(body.text || "").trim();
  return text.slice(0, 400) || fallback;
}

function parseToken(json: unknown): IglooKeyToken | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : "";
  const shareableUrl = typeof obj.shareableUrl === "string"
    ? obj.shareableUrl
    : typeof obj.shareable_url === "string"
    ? obj.shareable_url
    : "";
  if (!id || !shareableUrl) return null;
  return {
    id,
    shareableUrl,
    startsAt: typeof obj.startsAt === "string" ? obj.startsAt : null,
    endsAt: typeof obj.endsAt === "string" ? obj.endsAt : null,
    activationDeadline: typeof obj.activationDeadline === "string" ? obj.activationDeadline : null,
    type: typeof obj.type === "string" ? obj.type : null,
  };
}

/** iglooKey has no documented dedicated scope; unscoped grant is required. */
export async function getIglooKeyToken(
  clientId: string,
  clientSecret: string,
): Promise<OAuthResult> {
  const unscoped = await requestOAuthToken(clientId, clientSecret, []);
  if (unscoped.token) return unscoped;
  const ekey = await getOAuthToken(clientId, clientSecret, ["igloohomeapi/create-ekey-access"]);
  if (ekey.token) return ekey;
  return unscoped.token ? unscoped : ekey;
}

export async function createIglooKey(
  accessToken: string,
  body: {
    deviceIds: string[];
    label: string;
    endsAt: string;
    startsAt?: string;
    offlineAccessSeconds?: number;
  },
): Promise<{ ok: true; token: IglooKeyToken } | { ok: false; error: string; status: number }> {
  const payload: Record<string, unknown> = {
    deviceIds: body.deviceIds,
    label: body.label,
    endsAt: body.endsAt,
    offlineAccessSeconds: body.offlineAccessSeconds ?? IGLOOKEY_OFFLINE_ACCESS_SECONDS,
  };
  if (body.startsAt) payload.startsAt = body.startsAt;

  const res = await fetch(`${IGLOOHOME_HOME_API_BASE}/pass`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const parsed = await readResponse(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorMessage(parsed, `iglooKey create HTTP ${res.status}`),
    };
  }
  const token = parseToken(parsed.json);
  if (!token) {
    return { ok: false, status: res.status, error: "iglooKey create returned no shareableUrl" };
  }
  return { ok: true, token };
}

export async function updateIglooKey(
  accessToken: string,
  tokenId: string,
  body: { startsAt?: string; endsAt?: string },
): Promise<{ ok: true; token: Partial<IglooKeyToken> } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${IGLOOHOME_HOME_API_BASE}/pass/${encodeURIComponent(tokenId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = await readResponse(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorMessage(parsed, `iglooKey update HTTP ${res.status}`),
    };
  }
  const json = parsed.json as Record<string, unknown> | null;
  return {
    ok: true,
    token: {
      id: tokenId,
      startsAt: typeof json?.startsAt === "string" ? json.startsAt : body.startsAt,
      endsAt: typeof json?.endsAt === "string" ? json.endsAt : body.endsAt,
    },
  };
}

export async function revokeIglooKey(
  accessToken: string,
  tokenId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${IGLOOHOME_HOME_API_BASE}/pass/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 204 || res.status === 404) return { ok: true };
  const parsed = await readResponse(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorMessage(parsed, `iglooKey revoke HTTP ${res.status}`),
    };
  }
  return { ok: true };
}
