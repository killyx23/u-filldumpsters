// calculate-delivery-distance with CORS and MAPS_SERVER_KEY
const ALLOWED_ORIGIN = 'https://u-filldumpsters.com';
const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true'
};
function withCorsHeaders(resp) {
  for (const k of Object.keys(CORS))resp.headers.set(k, CORS[k]);
  return resp;
}
async function callGoogleDistanceMatrix(origin, destination, apiKey) {
  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    key: apiKey,
    units: 'imperial'
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google API ${res.status}`);
  return res.json();
}
Deno.serve(async (req)=>{
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }
    const MAPS_SERVER_KEY = Deno.env.get('MAPS_SERVER_KEY') || null;
    if (!MAPS_SERVER_KEY) {
      const resp = new Response(JSON.stringify({
        error: 'Missing secret: MAPS_SERVER_KEY'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return withCorsHeaders(resp);
    }
    const body = await req.json().catch(()=>null);
    if (!body || !body.origin || !body.destination) {
      const resp = new Response(JSON.stringify({
        error: 'Invalid payload, require origin and destination'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return withCorsHeaders(resp);
    }
    // Call Google Distance Matrix server-side using MAPS_SERVER_KEY (IP/key restricted)
    const google = await callGoogleDistanceMatrix(body.origin, body.destination, MAPS_SERVER_KEY);
    const resp = new Response(JSON.stringify({
      ok: true,
      google
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return withCorsHeaders(resp);
  } catch (err) {
    console.error(err);
    const resp = new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return withCorsHeaders(resp);
  }
});
