/** AAL is a JWT claim, not a field on auth.getUser(). Decode after the token is verified. */
export function getJwtAal(accessToken: string): "aal1" | "aal2" {
  try {
    const segment = accessToken.split(".")[1];
    if (!segment) return "aal1";
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { aal?: string };
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

export function isAdminWithMfa(
  user: { app_metadata?: { is_admin?: boolean } } | null | undefined,
  accessToken: string,
): boolean {
  return user?.app_metadata?.is_admin === true && getJwtAal(accessToken) === "aal2";
}
