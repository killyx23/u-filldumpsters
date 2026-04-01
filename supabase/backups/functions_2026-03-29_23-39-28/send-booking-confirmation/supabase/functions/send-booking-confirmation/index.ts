import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "https://u-filldumpsters.com";
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const { booking_id } = await req.json();
    if (!booking_id) {
      throw new Error("booking_id is required");
    }
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    // Fetch booking details
    const { data: booking, error: fetchError } = await supabaseAdmin.from("bookings").select("*, customers(*)").eq("id", booking_id).single();
    if (fetchError || !booking) {
      throw new Error(`Booking not found: ${fetchError?.message}`);
    }
    const customer = booking.customers;
    const isDelivery = booking.addons?.deliveryService || booking.addons?.isDelivery;
    const planName = booking.plan?.name || "Service";
    const serviceName = planName + (isDelivery ? " with Delivery" : "");
    const customerName = booking.first_name || customer?.first_name || booking.name;
    // Build the email template based on status
    let subject = "";
    let htmlContent = "";
    if (booking.status === "pending_verification" || booking.status === "pending_review") {
      subject = `Action Required: Your U-Fill Dumpsters Booking #${booking.id}`;
      htmlContent = `
            <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #d97706;">Action Required for Booking #${booking.id}</h2>
                <p>Hi ${customerName},</p>
                <p>We received your booking for <strong>${serviceName}</strong>. However, there is an action required before we can confirm it.</p>
                
                <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
                    <h3 style="margin-top: 0; color: #b45309;">Manual Review Pending</h3>
                    <p>Your booking is currently under manual review by our team.</p>
                    ${booking.was_verification_skipped ? `<p><strong>Reason:</strong> Driver/Vehicle verification was skipped during booking.</p>` : ''}
                    <p>We will contact you shortly if we need any further information.</p>
                </div>

                <p><strong>You can manage your booking and provide any missing details in your customer portal:</strong></p>
                <p>
                    <a href="${SITE_URL}/portal?portal_id=${customer?.customer_id_text}&phone=${booking.phone}" 
                       style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Access Customer Portal
                    </a>
                </p>
                <p style="font-size: 0.9em; color: #666; margin-top: 20px;">
                    Portal ID: ${customer?.customer_id_text}<br/>
                    Phone: ${booking.phone}
                </p>
            </div>
        `;
    } else if (booking.pending_address_verification) {
      subject = `⚠️ Address Verification Required: U-Fill Dumpsters Booking #${booking.id}`;
      htmlContent = `
            <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #ea580c;">⚠️ PENDING ADDRESS VERIFICATION</h2>
                <p>Hi ${customerName},</p>
                <p>Thank you for booking <strong>${serviceName}</strong> with U-Fill Dumpsters.</p>
                
                <div style="background-color: #ffedd5; border: 1px solid #fdba74; padding: 15px; margin: 20px 0; border-radius: 5px;">
                    <p style="margin-top: 0; font-weight: bold; color: #c2410c;">Your delivery address could not be automatically verified.</p>
                    <p><strong>Reason:</strong> Address not found in our system or entered manually.</p>
                    <p><strong>Unverified Address:</strong> ${booking.unverified_address}</p>
                </div>

                <h3 style="color: #1e3a8a;">What happens next:</h3>
                <ul>
                    <li>Our team will manually verify your address within 24-48 hours.</li>
                    <li><strong>Your delivery is on hold pending this verification.</strong></li>
                    <li>Delivery cannot proceed until the address is approved.</li>
                    <li>Cancellation fees may apply if the address is determined to be invalid or unserviceable.</li>
                </ul>

                <p>If you need to update or correct your address, please do so immediately in your Customer Portal:</p>
                <p style="margin: 20px 0;">
                    <a href="${SITE_URL}/portal?portal_id=${customer?.customer_id_text}&phone=${booking.phone}" 
                       style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                        Access Customer Portal
                    </a>
                </p>

                <div style="margin-top: 30px; font-size: 0.9em; color: #4b5563; background-color: #f3f4f6; padding: 15px; border-radius: 5px;">
                    <p style="margin-top: 0;"><strong>Portal Login Details:</strong></p>
                    <p>Portal ID: <span style="font-family: monospace;">${customer?.customer_id_text}</span></p>
                    <p>Phone: <span style="font-family: monospace;">${booking.phone}</span></p>
                </div>

                <p style="color: #666; font-size: 0.8em; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px;">
                    U-Fill Dumpsters LLC | Saratoga Springs, UT
                </p>
            </div>
        `;
    } else {
      subject = `Booking Confirmed: U-Fill Dumpsters #${booking.id}`;
      htmlContent = `
            <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #16a34a;">Booking Confirmed!</h2>
                <p>Hi ${customerName},</p>
                <p>Your booking for <strong>${serviceName}</strong> has been confirmed.</p>
                
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Booking Details:</h3>
                    <p><strong>ID:</strong> #${booking.id}</p>
                    <p><strong>Drop-off/Pickup:</strong> ${booking.drop_off_date} at ${booking.drop_off_time_slot}</p>
                    <p><strong>Return/Pickup:</strong> ${booking.pickup_date} by ${booking.pickup_time_slot}</p>
                    <p><strong>Total:</strong> $${booking.total_price?.toFixed(2)}</p>
                </div>

                <p>You can view your full receipt, manage your booking, and communicate with us via your Customer Portal:</p>
                <p>
                    <a href="${SITE_URL}/portal?portal_id=${customer?.customer_id_text}&phone=${booking.phone}" 
                       style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Access Customer Portal
                    </a>
                </p>
            </div>
        `;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
        to: [
          booking.email
        ],
        subject: subject,
        html: htmlContent
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("Resend API error:", errorText);
      throw new Error(`Failed to send email: ${errorText}`);
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
    console.error("Error in send-booking-confirmation:", error);
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
