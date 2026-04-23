import { corsHeaders } from "./cors.ts";
export const serve = async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      throw new Error("Missing bookingId");
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Fetch booking
    const bookingRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&select=*,customers(*)`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    const bookings = await bookingRes.json();
    if (!bookings || bookings.length === 0) {
      throw new Error("Booking not found");
    }
    const booking = bookings[0];
    const customer = booking.customers;
    const addons = booking.addons || {};
    let html = `<h2>Booking Confirmation - U-Fill Dumpsters</h2>`;
    html += `<p>Hello ${booking.name},</p>`;
    html += `<p>Thank you for your booking (ID: ${booking.id}). Here are your details:</p>`;
    html += `<h3>Order Summary:</h3>`;
    html += `<ul>`;
    html += `<li><strong>Total Paid:</strong> $${(booking.total_price || 0).toFixed(2)}</li>`;
    html += `<li><strong>Start Date:</strong> ${booking.drop_off_date}</li>`;
    html += `<li><strong>End Date:</strong> ${booking.pickup_date}</li>`;
    if (addons.mattressDisposal > 0) {
      html += `<li><strong>Mattress Disposal:</strong> ${addons.mattressDisposal} @ $25/unit = $${(addons.mattressDisposal * 25).toFixed(2)}</li>`;
    }
    if (addons.tvDisposal > 0) {
      html += `<li><strong>TV Disposal:</strong> ${addons.tvDisposal} @ $15/unit = $${(addons.tvDisposal * 15).toFixed(2)}</li>`;
    }
    if (addons.applianceDisposal > 0) {
      html += `<li><strong>Appliance Disposal:</strong> ${addons.applianceDisposal} @ $35/unit = $${(addons.applianceDisposal * 35).toFixed(2)}</li>`;
    }
    html += `</ul>`;
    html += `<p>For full details, please log in to your <a href="${Deno.env.get("SITE_URL")}/portal">Customer Portal</a>.</p>`;
    html += `<p>Best regards,<br/>U-Fill Dumpsters</p>`;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("BREVO_FROM_EMAIL") || "support@ufilldumpsters.com";
    if (resendApiKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: booking.email,
          subject: `Booking Confirmation - #${booking.id}`,
          html: html
        })
      });
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 400
    });
  }
};
Deno.serve(serve);
