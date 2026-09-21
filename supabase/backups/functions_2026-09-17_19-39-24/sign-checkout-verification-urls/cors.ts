const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
function parseAllowedOrigins() {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  return new Set(raw.split(',').map((origin)=>origin.trim()).filter(Boolean));
}
let cachedOrigins = null;
function getAllowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}
/** Origin-aware CORS headers. Set ALLOWED_ORIGINS (comma-separated) in env. */ export function getCorsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS
  };
  const origin = req.headers.get('Origin');
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}
