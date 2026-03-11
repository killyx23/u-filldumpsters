import { corsHeaders } from "./cors.ts";
const ORIGIN_ADDRESS = "16040 Idol rd, High Point, NC 27265";
async function verifyAddress(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'OK') {
    const result = data.results[0];
    if (result.partial_match) {
      return {
        isValid: false,
        message: "Address is a partial match. Please verify all details are correct."
      };
    }
    return {
      isValid: true,
      message: "Address verified."
    };
  } else if (data.status === 'ZERO_RESULTS') {
    return {
      isValid: false,
      message: "Address not found."
    };
  } else {
    console.error("Google Geocoding API Error:", data.error_message || data.status);
    return {
      isValid: false,
      message: `Could not verify address. Status: ${data.status}`
    };
  }
}
async function calculateDistance(destination, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
    const element = data.rows[0].elements[0];
    const distanceMiles = element.distance.value / 1609.34; // meters to miles
    // Fee Logic: First 30 miles included, then $0.85 per mile
    const extraMiles = Math.max(0, distanceMiles - 30);
    const fee = extraMiles * 0.85;
    return {
      miles: distanceMiles,
      roundTripMiles: distanceMiles * 2,
      duration: element.duration.text,
      fee: Math.round(fee * 100) / 100,
      mileageFee: Math.round(fee * 100) / 100
    };
  } else {
    console.error("Google Distance Matrix API Error:", data.error_message || data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0] && data.rows[0].elements[0].status || data.status);
    return null;
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { address, serviceType } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    let apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!apiKey) {
      console.error("Google Maps API key is not set.");
      throw new Error("Server configuration error: Missing Maps API Key");
    }
    apiKey = apiKey.trim();
    const verificationResult = await verifyAddress(address, apiKey);
    if (!verificationResult.isValid) {
      return new Response(JSON.stringify(verificationResult), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    let distanceInfo = null;
    // Only calculate distance for specific service types if needed, currently running for 1 (Dumpster) and 3 (Materials) based on legacy code
    // or run for all if serviceType logic requires it.
    if (serviceType === 1 || serviceType === 3 || serviceType === 2 || serviceType === 4) {
      distanceInfo = await calculateDistance(address, apiKey);
    }
    return new Response(JSON.stringify({
      isValid: true,
      message: "Address verified",
      distanceInfo
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Verify-address-and-distance function error:", error.message);
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
