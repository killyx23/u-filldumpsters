import { corsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { notificationType, bookingId, customerEmail, details } = await req.json();
    // In a real scenario, this would use SendGrid or Resend to dispatch the email.
    // We log the attempt and return success.
    console.log(`Sending ${notificationType} to ${customerEmail} for booking ${bookingId}`);
    console.log('Details:', details);
    return new Response(JSON.stringify({
      success: true,
      message: "Notification sent."
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
