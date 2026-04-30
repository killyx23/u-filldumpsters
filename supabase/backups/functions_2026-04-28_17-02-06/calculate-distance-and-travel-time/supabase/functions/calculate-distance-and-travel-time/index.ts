import { corsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    console.log("[Distance API] Received request body floppy:", body);
    const { customerAddress, businessLat, businessLng } = body;
    if (!customerAddress || typeof customerAddress !== 'string') {
      console.error("[Distance API] Missing or invalid customerAddress");
      throw new Error('customerAddress is required and must be a string');
    }
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error("[Distance API] GOOGLE_MAPS_API_KEY secret is missing");
      throw new Error('Server configuration error: Google Maps API key is missing');
    }
    // Default coordinates if not provided (e.g., U-Fill Dumpsters default location)
    // Validating latitude (-90 to 90) and longitude (-180 to 180)
    let lat = 28.6122;
    let lng = -80.8075;
    if (businessLat !== undefined && !isNaN(businessLat) && businessLat >= -90 && businessLat <= 90) {
      lat = businessLat;
    }
    if (businessLng !== undefined && !isNaN(businessLng) && businessLng >= -180 && businessLng <= 180) {
      lng = businessLng;
    }
    const origin = `${lat},${lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${encodeURIComponent(customerAddress)}&units=imperial&key=${apiKey}`;
    console.log(`[Distance API] Fetching distance from origin: ${origin} to destination: ${customerAddress}`);
    const res = await fetch(url);
    const data = await res.json();
    console.log(`[Distance API] Google Maps Response Status:`, data.status);
    if (data.status !== 'OK') {
      const errorMsg = data.error_message ? ` - ${data.error_message}` : '';
      console.error(`[Distance API] API Error: ${data.status}${errorMsg}`);
      throw new Error(`Google Maps API error: ${data.status}${errorMsg}`);
    }
    if (!data.rows || !data.rows[0] || !data.rows[0].elements || !data.rows[0].elements[0]) {
      console.error("[Distance API] Unexpected API response structure:", data);
      throw new Error("Unexpected response from Google Maps");
    }
    const element = data.rows[0].elements[0];
    if (element.status !== 'OK') {
      console.error(`[Distance API] Element Status Error: ${element.status}`);
      throw new Error(`Cannot calculate route to this address: ${element.status}`);
    }
    // distance.value is in meters, duration.value is in seconds
    const distanceMiles = parseFloat((element.distance.value / 1609.34).toFixed(1));
    const travelTimeMinutes = Math.round(element.duration.value / 60);
    console.log(`[Distance API] Calculation Success - Distance: ${distanceMiles}mi, Time: ${travelTimeMinutes}min`);
    return new Response(JSON.stringify({
      distance: distanceMiles,
      travelTime: travelTimeMinutes
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("[Distance API] Unhandled Exception:", error.message);
    return new Response(JSON.stringify({
      error: error.message || 'An unknown error occurred during calculation'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
