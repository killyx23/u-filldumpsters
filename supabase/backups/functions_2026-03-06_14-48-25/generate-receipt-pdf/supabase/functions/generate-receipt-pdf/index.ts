import { corsHeaders } from './cors.ts';
// This function is now a simple pass-through. 
// The actual HTML generation and PDF conversion logic has been moved to 'get-receipt-pdf'
// to simplify the function chain and reduce potential points of failure.
// This function can be deprecated or repurposed later if needed.
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // This function now expects the full booking object.
    const { booking } = await req.json();
    if (!booking) {
      throw new Error('Booking data is required.');
    }
    // It simply returns the booking data it received.
    // The caller ('get-receipt-pdf') will handle the HTML generation.
    return new Response(JSON.stringify({
      bookingData: booking
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Generate Receipt PDF (Pass-through) Error:", error);
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
