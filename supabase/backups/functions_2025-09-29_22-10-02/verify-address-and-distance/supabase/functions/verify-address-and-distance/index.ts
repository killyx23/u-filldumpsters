import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const ORIGIN_ADDRESS = "227 West Casi Way, Saratoga Springs, Utah 84045";
// Separate function for address verification
async function verifyAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set.");
    return {
      isValid: false,
      message: "Server configuration error."
    };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
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
      message: "Could not verify address at this time."
    };
  }
}
// Separate function for distance calculation
async function calculateDistance(destination) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set for distance calculation.");
    return null;
  }
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
    const element = data.rows[0].elements[0];
    const distanceMiles = element.distance.value / 1609.34; // meters to miles
    const extraMiles = Math.max(0, distanceMiles - 30);
    const fee = extraMiles * 0.80;
    return {
      miles: distanceMiles,
      duration: element.duration.text,
      fee: fee
    };
  } else {
    console.error("Google Distance Matrix API Error:", data.error_message || data.status);
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
    const verificationResult = await verifyAddress(address);
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
    // Only calculate distance for non-trailer rentals
    if (serviceType === 1 || serviceType === 3) {
      distanceInfo = await calculateDistance(address);
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
