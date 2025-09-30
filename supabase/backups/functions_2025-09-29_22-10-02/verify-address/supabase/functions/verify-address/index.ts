import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set.");
    return new Response(JSON.stringify({
      error: "Server configuration error."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
  try {
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required for verification.");
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK') {
      // Check for partial matches or rooftop accuracy
      const result = data.results[0];
      const isRooftop = result.geometry.location_type === 'ROOFTOP';
      const isPartialMatch = result.partial_match;
      if (isPartialMatch) {
        return new Response(JSON.stringify({
          isValid: false,
          message: "Address is a partial match. Please verify all details are correct."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 200
        });
      }
      return new Response(JSON.stringify({
        isValid: true,
        isRooftop
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    } else if (data.status === 'ZERO_RESULTS') {
      return new Response(JSON.stringify({
        isValid: false,
        message: "Address not found."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    } else {
      console.error("Google Geocoding API Error:", data.error_message || data.status);
      throw new Error("Could not verify address at this time.");
    }
  } catch (error) {
    console.error("Verify address function error:", error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
