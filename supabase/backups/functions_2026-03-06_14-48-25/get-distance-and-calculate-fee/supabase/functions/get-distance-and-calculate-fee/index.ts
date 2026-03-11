import { corsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { address } = await req.json();
    if (!address) {
      throw new Error('Address is required');
    }
    // Retrieve and sanitize API Key
    let apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error("GOOGLE_MAPS_API_KEY is missing in environment variables");
      throw new Error('Server configuration error: Missing Maps API Key');
    }
    apiKey = apiKey.trim();
    // 1. Geocode the customer's address to get coordinates
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();
    if (geocodeData.status !== 'OK') {
      console.error("Geocoding failed:", geocodeData.status, geocodeData.error_message);
      throw new Error(`Could not verify address. Status: ${geocodeData.status}`);
    }
    const formattedAddress = geocodeData.results[0].formatted_address;
    // 2. Calculate distance from fixed origin
    const origin = "16040 Idol rd, High Point, NC 27265";
    const distanceUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
    const distanceRes = await fetch(distanceUrl);
    const distanceData = await distanceRes.json();
    if (distanceData.status !== 'OK') {
      console.error("Distance Matrix failed:", distanceData.status, distanceData.error_message);
      throw new Error(`Could not calculate distance. Status: ${distanceData.status}`);
    }
    const element = distanceData.rows[0].elements[0];
    if (element.status !== 'OK') {
      throw new Error(`Could not calculate distance to this specific location. Status: ${element.status}`);
    }
    // 3. Calculate Fee Logic
    // Logic: First 30 miles free (one-way), then charged per mile.
    // Fee structure based on frontend hints: $0.85/mile charge.
    const milesValue = element.distance.value; // meters
    const milesOneWay = milesValue * 0.000621371; // convert meters to miles
    const freeMilesLimit = 30;
    const costPerMile = 0.85;
    let fee = 0;
    if (milesOneWay > freeMilesLimit) {
      const chargeableMiles = milesOneWay - freeMilesLimit;
      // Often businesses charge for the round trip of the EXTRA miles, or just a higher rate per one-way mile.
      // Based on "0.85 per mile" phrasing, we'll apply it to the excess one-way miles.
      // If strict round-trip charging is needed, this would be chargeableMiles * costPerMile * 2.
      // We will stick to a standard implementation matching the likely intent:
      fee = chargeableMiles * costPerMile;
    }
    // Round to 2 decimals
    fee = Math.round(fee * 100) / 100;
    return new Response(JSON.stringify({
      isValid: true,
      formattedAddress: formattedAddress,
      distanceInfo: {
        miles: milesOneWay,
        roundTripMiles: milesOneWay * 2,
        fee: fee,
        mileageFee: fee,
        duration: element.duration.text
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
