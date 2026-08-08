import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY");
const BUSINESS_ADDRESS = "227 W Casi Way, Saratoga Springs, UT 84045";
const DELIVERY_BASE_FEE = 30;
const PER_MILE_RATE = 0.85;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log("[get-distance-and-calculate-fee] Function invoked");
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    console.log(`[get-distance-and-calculate-fee] Calculating distance from ${BUSINESS_ADDRESS} to ${address}`);
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("[get-distance-and-calculate-fee] GOOGLE_MAPS_API_KEY is missing");
      return generateWarningResponse("Server configuration error: Maps API Key missing.");
    }
    const mapsUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(BUSINESS_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
    const mapsResponse = await fetch(mapsUrl);
    if (!mapsResponse.ok) {
      const errorText = await mapsResponse.text();
      console.error("[get-distance-and-calculate-fee] Google Maps API Error:", errorText);
      return generateWarningResponse("Google Maps API request failed.");
    }
    const mapsData = await mapsResponse.json();
    console.log("[get-distance-and-calculate-fee] Google Maps API Response Status:", mapsData.status);
    if (mapsData.status !== 'OK' || !mapsData.rows[0]?.elements[0]) {
      console.warn(`[get-distance-and-calculate-fee] Google Maps API returned non-OK status: ${mapsData.status}`, mapsData);
      return generateWarningResponse(`Could not calculate distance accurately. API Status: ${mapsData.status}`);
    }
    const element = mapsData.rows[0].elements[0];
    if (element.status !== 'OK') {
      console.warn(`[get-distance-and-calculate-fee] Element status not OK: ${element.status}`);
      return generateWarningResponse(element.status === 'NOT_FOUND' ? "We couldn't find a route to that address. Please double-check for typos." : `Could not verify route. Status: ${element.status}`);
    }
    const distanceInMeters = element.distance.value;
    const miles = distanceInMeters / 1609.34;
    const roundTripMiles = miles * 2;
    const mileageFee = roundTripMiles * PER_MILE_RATE;
    const totalFee = DELIVERY_BASE_FEE + mileageFee;
    console.log(`[get-distance-and-calculate-fee] Success! Miles: ${miles.toFixed(2)}, Fee: $${totalFee.toFixed(2)}`);
    return new Response(JSON.stringify({
      success: true,
      miles: miles,
      roundTripMiles: roundTripMiles,
      mileageFee: mileageFee,
      deliveryFee: DELIVERY_BASE_FEE,
      totalFee: totalFee,
      unverifiedAddress: false
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[get-distance-and-calculate-fee] Exception caught:", error);
    return generateWarningResponse(error.message);
  }
});
function generateWarningResponse(reason) {
  console.warn(`[get-distance-and-calculate-fee] Returning warning response: ${reason}`);
  return new Response(JSON.stringify({
    success: true,
    miles: null,
    roundTripMiles: null,
    mileageFee: 0,
    deliveryFee: DELIVERY_BASE_FEE,
    totalFee: DELIVERY_BASE_FEE,
    unverifiedAddress: true,
    warning: "Address could not be verified automatically. Proceeding with caution. " + reason
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    status: 200
  });
}
