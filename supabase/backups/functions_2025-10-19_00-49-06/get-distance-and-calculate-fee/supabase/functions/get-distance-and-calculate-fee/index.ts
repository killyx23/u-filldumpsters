import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
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
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    const mapsUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(BUSINESS_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
    const mapsResponse = await fetch(mapsUrl);
    if (!mapsResponse.ok) {
      const errorText = await mapsResponse.text();
      console.error("Google Maps API Error:", errorText);
      throw new Error(`Google Maps API request failed with status: ${mapsResponse.status}.`);
    }
    const mapsData = await mapsResponse.json();
    if (mapsData.status !== 'OK' || !mapsData.rows[0].elements[0]) {
      console.error("Google Maps API returned non-OK status:", mapsData);
      throw new Error(`Could not calculate distance. Status: ${mapsData.status}.`);
    }
    const element = mapsData.rows[0].elements[0];
    if (element.status !== 'OK') {
      if (element.status === 'NOT_FOUND') {
        return new Response(JSON.stringify({
          error: "We couldn't find a route to that address. Please double-check for typos or try a different format."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 400
        });
      }
      console.error("Google Maps Matrix Element Error:", element);
      throw new Error(`Could not find a route to the address. Status: ${element.status}.`);
    }
    const distanceInMeters = element.distance.value;
    const miles = distanceInMeters / 1609.34;
    const roundTripMiles = miles * 2;
    const mileageFee = roundTripMiles * PER_MILE_RATE;
    const totalFee = DELIVERY_BASE_FEE + mileageFee;
    return new Response(JSON.stringify({
      miles: miles,
      roundTripMiles: roundTripMiles,
      mileageFee: mileageFee,
      deliveryFee: DELIVERY_BASE_FEE,
      totalFee: totalFee
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Error in get-distance-and-calculate-fee function:", error.message);
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
