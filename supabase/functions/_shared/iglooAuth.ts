/**
 * Shared Igloohome OAuth (client_credentials).
 *
 * Cognito rejects the entire token exchange (HTTP 400 invalid_request) if any
 * requested scope is not authorized on the app client. Request the full set
 * first, then drop known-optional scopes, then omit scope entirely so Cognito
 * grants whatever the client actually owns.
 */

export const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";

/** Scopes used by bridge PIN create/delete + job polling + device listing. */
export const BRIDGE_PIN_SCOPES = [
  "igloohomeapi/create-pin-bridge-proxied-job",
  "igloohomeapi/delete-pin-bridge-proxied-job",
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/store-device-activity",
] as const;

/** Scopes used by generate-pin / AlgoPIN production path. */
export const GENERATE_PIN_SCOPES = [
  "igloohomeapi/create-pin-bridge-proxied-job",
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/algopin-onetime",
  "igloohomeapi/store-device-activity",
] as const;

/**
 * Legacy umbrella scope — newer Igloohome apps use per-job scopes instead
 * (e.g. create-pin-bridge-proxied-job, get-activity-logs-bridge-proxied-job).
 * Including an unauthorized scope causes Cognito to reject the whole exchange.
 */
export const OPTIONAL_OAUTH_SCOPES = [
  "igloohomeapi/create-bridge-proxied-job",
] as const;

export type OAuthResult = { token: string | null; reason?: string; scopesUsed?: string };

/** Correct scope for bridge activity-log jobs (jobType 15). */
export const ACTIVITY_SYNC_SCOPE = "igloohomeapi/get-activity-logs-bridge-proxied-job";

/**
 * Scope for GET /devices/{id}/activity.
 * Empirically this endpoint 403s unless the access token was issued with ONLY
 * this scope (mixing it with get-activity-logs-bridge-proxied-job or using an
 * unscoped "all owned scopes" grant returns 403).
 */
export const DEVICE_ACTIVITY_SCOPE = "igloohomeapi/get-device-activity";

/** Operation-specific scopes for remote Bridge Lock/Unlock jobs. */
export const REMOTE_LOCK_SCOPE = "igloohomeapi/lock-bridge-proxied-job";
export const REMOTE_UNLOCK_SCOPE = "igloohomeapi/unlock-bridge-proxied-job";

/**
 * Obtain a fresh token for one remote lock operation.
 * Igloohome requires the operation scope to be explicitly requested.
 */
export async function getRemoteLockJobToken(
  clientId: string,
  clientSecret: string,
  operation: "lock" | "unlock",
): Promise<OAuthResult> {
  const requiredScope = operation === "lock" ? REMOTE_LOCK_SCOPE : REMOTE_UNLOCK_SCOPE;
  const result = await requestOAuthToken(clientId, clientSecret, [
    requiredScope,
    "igloohomeapi/get-job-status",
  ]);
  if (result.token && tokenHasScope(result.token, requiredScope)) return result;

  const operationOnly = await requestOAuthToken(clientId, clientSecret, [requiredScope]);
  if (operationOnly.token && tokenHasScope(operationOnly.token, requiredScope)) {
    return operationOnly;
  }

  return {
    token: null,
    reason: result.token
      ? `OAuth token did not contain required scope ${requiredScope}`
      : operationOnly.reason || result.reason || `Could not obtain ${operation} token`,
    scopesUsed: operationOnly.scopesUsed || result.scopesUsed,
  };
}

/** Scopes required to pull lock activity logs (jobType 15). */
export const ACTIVITY_SYNC_SCOPES = [
  ACTIVITY_SYNC_SCOPE,
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/store-device-activity",
] as const;

export const ACTIVITY_SYNC_SCOPE_HINT =
  "Enable the Igloohome API scope igloohomeapi/get-activity-logs-bridge-proxied-job on your developer credentials " +
  "(https://web.igloohome.co/api/). PIN create uses create-pin-bridge-proxied-job and can work without it; " +
  "Sync Lock Activity (jobType 15) cannot. Until then, use Simulate Unlock / Simulate Lock in the test lab.";

export const DEVICE_ACTIVITY_SCOPE_HINT =
  "Enable igloohomeapi/get-device-activity on your Igloohome developer credentials " +
  "(https://web.igloohome.co/api/). Sync needs it to read unlock/lock history after the Bridge pull.";

/** Decode Cognito access-token scope claim (space-separated). */
export function tokenScopes(accessToken: string): string[] {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return [];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(normalized));
    return String(json.scope || "").split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

export function tokenHasScope(accessToken: string, scope: string): boolean {
  return tokenScopes(accessToken).includes(scope);
}

/**
 * Token for activity-log sync. Requires get-activity-logs-bridge-proxied-job —
 * do not silently fall back to a weaker token that will only 403 on jobType 15.
 */
export async function getActivitySyncToken(
  clientId: string,
  clientSecret: string,
): Promise<OAuthResult> {
  // Prefer an explicit grant that includes the required scope.
  const explicit = await requestOAuthToken(clientId, clientSecret, ACTIVITY_SYNC_SCOPES);
  if (explicit.token && tokenHasScope(explicit.token, ACTIVITY_SYNC_SCOPE)) {
    return explicit;
  }

  const onlyRequired = await requestOAuthToken(clientId, clientSecret, [ACTIVITY_SYNC_SCOPE]);
  if (onlyRequired.token && tokenHasScope(onlyRequired.token, ACTIVITY_SYNC_SCOPE)) {
    return onlyRequired;
  }

  // Unscoped grant = every scope the app client owns.
  const unscoped = await requestOAuthToken(clientId, clientSecret, []);
  if (unscoped.token && tokenHasScope(unscoped.token, ACTIVITY_SYNC_SCOPE)) {
    return unscoped;
  }

  if (unscoped.token && !tokenHasScope(unscoped.token, ACTIVITY_SYNC_SCOPE)) {
    return {
      token: null,
      reason: `OAuth succeeded but the token does not include ${ACTIVITY_SYNC_SCOPE}. ${ACTIVITY_SYNC_SCOPE_HINT}`,
      scopesUsed: unscoped.scopesUsed,
    };
  }

  return {
    token: null,
    reason: `${onlyRequired.reason || explicit.reason || "OAuth failed"}. ${ACTIVITY_SYNC_SCOPE_HINT}`,
    scopesUsed: onlyRequired.scopesUsed || explicit.scopesUsed,
  };
}

/**
 * Token for GET /devices/{id}/activity. Must be a solo-scope grant — see
 * DEVICE_ACTIVITY_SCOPE comment.
 */
export async function getDeviceActivityToken(
  clientId: string,
  clientSecret: string,
): Promise<OAuthResult> {
  const only = await requestOAuthToken(clientId, clientSecret, [DEVICE_ACTIVITY_SCOPE]);
  if (only.token && tokenHasScope(only.token, DEVICE_ACTIVITY_SCOPE)) {
    return only;
  }
  return {
    token: null,
    reason: `${only.reason || "OAuth failed"}. ${DEVICE_ACTIVITY_SCOPE_HINT}`,
    scopesUsed: only.scopesUsed,
  };
}


async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

export async function requestOAuthToken(
  clientId: string,
  clientSecret: string,
  scopes: readonly string[] = BRIDGE_PIN_SCOPES,
): Promise<OAuthResult> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (scopes.length) form.set("scope", scopes.join(" "));

  let res: Response;
  try {
    res = await fetch(IGLOOHOME_OAUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });
  } catch (err) {
    return { token: null, reason: `network error reaching auth.igloohome.co: ${err}` };
  }

  const body = await readResponse(res);
  if (!res.ok || !body.json?.access_token) {
    const detail = body.json?.error_description || body.json?.error || body.text ||
      "(empty response)";
    return {
      token: null,
      reason: `Igloohome OAuth HTTP ${res.status}: ${String(detail).slice(0, 300)}`,
      scopesUsed: scopes.length ? scopes.join(" ") : "(none)",
    };
  }
  return {
    token: body.json.access_token as string,
    scopesUsed: scopes.length ? scopes.join(" ") : "(none — Cognito default grant)",
  };
}

/**
 * Obtain an access token, falling back when optional scopes are unauthorized.
 */
export async function getOAuthToken(
  clientId: string,
  clientSecret: string,
  scopes: readonly string[] = BRIDGE_PIN_SCOPES,
): Promise<OAuthResult> {
  const full = await requestOAuthToken(clientId, clientSecret, scopes);
  if (full.token) return full;

  const optional = new Set<string>(OPTIONAL_OAUTH_SCOPES);
  const reduced = scopes.filter((s) => !optional.has(s));
  if (reduced.length && reduced.length !== scopes.length) {
    const retry = await requestOAuthToken(clientId, clientSecret, reduced);
    if (retry.token) return retry;
  }

  // Prefer a grant that explicitly includes algopin when the caller asked for it,
  // without the unauthorized create-bridge-proxied-job scope.
  if (scopes.includes("igloohomeapi/algopin-onetime")) {
    const algoOnly = [
      "igloohomeapi/algopin-onetime",
      "igloohomeapi/get-devices",
      "igloohomeapi/get-job-status",
    ];
    const algo = await requestOAuthToken(clientId, clientSecret, algoOnly);
    if (algo.token) return algo;
  }

  // Omitting scope entirely makes Cognito grant every scope the app client owns.
  const unscoped = await requestOAuthToken(clientId, clientSecret, []);
  if (unscoped.token) return unscoped;

  return full;
}

export type DiagnoseRow = {
  scopes: string;
  ok: boolean;
  reason: string | null;
};

/** Probe several scope sets. Never returns tokens. */
export async function diagnoseOAuth(
  clientId: string,
  clientSecret: string,
): Promise<DiagnoseRow[]> {
  const cases: Array<{ label: string; scopes: readonly string[] }> = [
    { label: "no scope requested (Cognito grants all owned)", scopes: [] },
    { label: "bridge PIN set (setup/clear)", scopes: BRIDGE_PIN_SCOPES },
    { label: "generate-pin / AlgoPIN set", scopes: GENERATE_PIN_SCOPES },
    { label: "activity sync set (jobType 15)", scopes: ACTIVITY_SYNC_SCOPES },
    {
      label: "create-pin + get-devices",
      scopes: [
        "igloohomeapi/create-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
      ],
    },
    { label: "only igloohomeapi/algopin-onetime", scopes: ["igloohomeapi/algopin-onetime"] },
    { label: `only ${ACTIVITY_SYNC_SCOPE}`, scopes: [ACTIVITY_SYNC_SCOPE] },
    { label: `only ${DEVICE_ACTIVITY_SCOPE}`, scopes: [DEVICE_ACTIVITY_SCOPE] },
    { label: "only igloohomeapi/create-bridge-proxied-job (legacy)", scopes: ["igloohomeapi/create-bridge-proxied-job"] },
    ...BRIDGE_PIN_SCOPES.map((s) => ({ label: `only ${s}`, scopes: [s] as const })),
  ];

  const results: DiagnoseRow[] = [];
  for (const c of cases) {
    const r = await requestOAuthToken(clientId, clientSecret, c.scopes);
    results.push({
      scopes: c.label,
      ok: !!r.token,
      reason: r.token ? null : (r.reason ?? "unknown"),
    });
  }
  return results;
}

/** Human-readable hint when Igloohome returns bridge unreachable. */
export function bridgeOfflineHint(errorText: string | undefined | null): string | null {
  const t = String(errorText || "");
  if (/unable to contact bridge|bridge.*offline|406/i.test(t)) {
    return (
      "Igloohome's cloud cannot reach your Bridge right now. " +
      "An empty PIN list in the Igloo app does not mean the Bridge is online — " +
      "check Bridge power/Wi‑Fi, wait ~1 minute after it reconnects, then retry. " +
      "Meanwhile use Setup + AlgoPIN (works offline)."
    );
  }
  return null;
}
