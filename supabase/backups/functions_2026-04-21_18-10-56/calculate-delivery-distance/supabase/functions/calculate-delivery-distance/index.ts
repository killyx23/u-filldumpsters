import { corsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { pickup_location = "South Saratoga Springs, UT", delivery_address } = await req.json();
    if (!delivery_address) {
      return new Response(JSON.stringify({
        error: 'Delivery address is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error('Google Maps API key is not configured in environment variables');
      return new Response(JSON.stringify({
        error: 'Distance calculation service is currently unavailable (Missing API Key)'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`[Distance Calculation] Origin: ${pickup_location} | Destination: ${delivery_address}`);
    const origin = encodeURIComponent(pickup_location);
    const destination = encodeURIComponent(delivery_address);
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&units=imperial&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    console.log('[Distance Calculation] Google API Response Status:', data.status);
    if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
      const distanceText = data.rows[0].elements[0].distance.text;
      const oneWayDistance = parseFloat(distanceText.replace(/[^0-9.]/g, ''));
      // Calculate round-trip distance as per standard delivery fee practices
      const distance_miles = oneWayDistance * 2;
      const distance_km = distance_miles * 1.60934;
      console.log(`[Distance Calculation] Success: ${distance_miles} miles (round trip)`);
      return new Response(JSON.stringify({
        distance_miles,
        distance_km,
        one_way_miles: oneWayDistance
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      const apiStatus = data.rows?.[0]?.elements?.[0]?.status || data.status;
      console.error('[Distance Calculation] Google Maps API Error Details:', JSON.stringify(data));
      throw new Error(`Unable to calculate route. API Status: ${apiStatus}. Please check if the address is valid and accessible.`);
    }
  } catch (error) {
    console.error('[Distance Calculation] Execution Error:', error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
