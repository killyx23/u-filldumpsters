import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const SITE_URL = Deno.env.get("SITE_URL") || "https://u-filldumpsters.com";
const formatCurrency = (amount)=>{
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amount);
};
const formatDate = (dateString)=>{
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch  {
    return dateString;
  }
};
const formatTime = (timeString)=>{
  if (!timeString) return "N/A";
  try {
    const [hours, minutes] = timeString.split(":");
    const date = new Date();
    date.setHours(parseInt(hours, 10));
    date.setMinutes(parseInt(minutes || "0", 10));
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  } catch  {
    return timeString;
  }
};
const generateEmailHTML = (booking, serviceDetails)=>{
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || 'N/A';
  const phone = booking.customers?.phone || booking.phone || 'N/A';
  const portalUrl = `${SITE_URL}/login?phone=${encodeURIComponent(phone)}&portal_number=${encodeURIComponent(customerIdText)}`;
  const serviceName = serviceDetails?.name || plan.name || "N/A";
  const serviceDescription = serviceDetails?.description || "";
  const serviceType = serviceDetails?.service_type || plan.service_type || "";
  let equipmentHTML = "";
  if (addons.equipment && addons.equipment.length > 0) {
    equipmentHTML = `
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Equipment Rental:</h3>
        <ul style="list-style: none; padding: 0;">
          ${addons.equipment.map((item)=>`
            <li style="padding: 5px 0; border-bottom: 1px solid #e5e7eb;">
              ${item.label || item.name} (Quantity: ${item.quantity})
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }
  let addonsHTML = "";
  if (addons.insurance === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Rental Insurance</li>`;
  }
  if (addons.drivewayProtection === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Driveway Protection</li>`;
  }
  let nextStepsHTML = "";
  if (serviceType === 'trailer_rental' || serviceName.toLowerCase().includes('dump loader') || serviceName.toLowerCase().includes('trailer')) {
    nextStepsHTML = `
      <li>Pick up the trailer at our location on ${formatDate(booking.drop_off_date)} at ${formatTime(booking.drop_off_time_slot)}.</li>
      <li>Ensure your towing vehicle meets the minimum requirements (usually a 1/2-ton truck or larger with a 2" ball hitch).</li>
      <li>Fill the trailer at your convenience during the rental period.</li>
      <li>Return the trailer by ${formatDate(booking.pickup_date)} at ${formatTime(booking.pickup_time_slot)}.</li>
      <li>Make sure the trailer is empty and clean before returning.</li>
     `;
  } else {
    nextStepsHTML = `
      <li>We'll arrive at your location on ${formatDate(booking.drop_off_date)} at ${formatTime(booking.drop_off_time_slot)}.</li>
      <li>Our team will place the dumpster in your designated area.</li>
      <li>Fill the dumpster at your convenience during the rental period.</li>
      <li>We'll pick up the dumpster on ${formatDate(booking.pickup_date)} by ${formatTime(booking.pickup_time_slot)}.</li>
     `;
  }
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Booking Confirmed!</h1>
      <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 16px;">Thank you for choosing U-Fill Dumpsters</p>
    </div>

    <!-- Body -->
    <div style="padding: 30px 20px;">
      
      <!-- Success Message -->
      <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #065f46; font-weight: bold;">✓ Your booking has been confirmed successfully!</p>
      </div>

      <!-- Booking ID -->
      <div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Booking ID</p>
        <p style="margin: 5px 0 0 0; color: #1e40af; font-size: 32px; font-weight: bold;">#${booking.id}</p>
      </div>

      <!-- Customer Information -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Customer Information</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Name:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.name || `${booking.first_name} ${booking.last_name}`}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Email:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.email}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Phone:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.phone}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Address:</td>
            <td style="padding: 8px 0; color: #1f2937;">${deliveryAddress.street || booking.street}, ${deliveryAddress.city || booking.city}, ${deliveryAddress.state || booking.state} ${deliveryAddress.zip || booking.zip}</td>
          </tr>
        </table>
      </div>

      <!-- Service Details -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Service Details</h2>
        <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: bold; font-size: 16px;">${serviceName}</p>
        ${serviceDescription ? `<p style="margin: 0 0 15px 0; color: #4b5563; font-size: 14px; line-height: 1.5;">${serviceDescription}</p>` : ''}
        
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Drop-off:</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDate(booking.drop_off_date)} at ${formatTime(booking.drop_off_time_slot)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Pickup:</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDate(booking.pickup_date)} by ${formatTime(booking.pickup_time_slot)}</td>
          </tr>
        </table>
      </div>

      ${equipmentHTML}

      ${addonsHTML ? `
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Additional Services:</h3>
        <ul style="list-style: none; padding: 0;">
          ${addonsHTML}
        </ul>
      </div>
      ` : ""}

      <!-- Total -->
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Total Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(booking.total_price)}</p>
      </div>

      <!-- Special Notes -->
      ${booking.notes ? `
      <div style="margin-top: 25px; padding: 15px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-weight: bold;">Special Instructions:</p>
        <p style="margin: 10px 0 0 0; color: #78350f;">${booking.notes}</p>
      </div>
      ` : ""}

      <!-- Next Steps -->
      <div style="margin-top: 30px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
        <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">What's Next?</h3>
        <ol style="margin: 0; padding-left: 20px; color: #4b5563; line-height: 1.8;">
          ${nextStepsHTML}
        </ol>
      </div>

      <!-- Customer Portal Access -->
      <div style="margin-top: 30px; padding: 25px 20px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
        <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">🔑 Customer Portal Access</h3>
        <p style="margin: 0 0 20px 0; color: #78350f; font-size: 15px; line-height: 1.5;">Access your booking details, make changes, and track your rental anytime through our Customer Portal.</p>
        
        <table style="width: 100%; border-collapse: separate; border-spacing: 15px 0; margin-bottom: 25px; margin-left: -15px;">
          <tr>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Portal ID</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${customerIdText}</p>
            </td>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Phone Number</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${phone}</p>
            </td>
          </tr>
        </table>

        <div style="text-align: center;">
          <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Go to Customer Portal</a>
        </div>
      </div>

      <!-- Contact Information -->
      <div style="margin-top: 30px; text-align: center; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Need to make changes or have questions?</p>
        <p style="margin: 0; color: #1f2937; font-weight: bold;">Contact Us</p>
        <p style="margin: 5px 0 0 0; color: #3b82f6;">support@u-filldumpsters.com</p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; padding: 20px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">© 2026 U-Fill Dumpsters LLC. All rights reserved.</p>
      <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px;">This is an automated confirmation email. Please do not reply.</p>
    </div>

  </div>
</body>
</html>
  `;
};
const sendEmailWithRetry = async (toEmail, subject, htmlContent, maxRetries = 2)=>{
  let lastError = null;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [send-booking-confirmation] Attempt ${attempt}/${maxRetries} to send email to ${toEmail}`);
    try {
      if (RESEND_API_KEY) {
        console.log(`[${timestamp}] [send-booking-confirmation] Using Resend API`);
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [
              toEmail
            ],
            subject: subject,
            html: htmlContent
          })
        });
        if (resendResponse.ok) {
          const result = await resendResponse.json();
          console.log(`[${timestamp}] [send-booking-confirmation] Email sent successfully via Resend:`, result);
          return {
            success: true,
            provider: "resend",
            result
          };
        } else {
          const errorText = await resendResponse.text();
          lastError = `Resend API error: ${errorText}`;
          console.error(`[${timestamp}] [send-booking-confirmation] Resend failed:`, lastError);
        }
      }
      if (BREVO_API_KEY) {
        console.log(`[${timestamp}] [send-booking-confirmation] Using Brevo API`);
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender: {
              email: BREVO_FROM_EMAIL,
              name: "U-Fill Dumpsters"
            },
            to: [
              {
                email: toEmail
              }
            ],
            subject: subject,
            htmlContent: htmlContent
          })
        });
        if (brevoResponse.ok) {
          const result = await brevoResponse.json();
          console.log(`[${timestamp}] [send-booking-confirmation] Email sent successfully via Brevo:`, result);
          return {
            success: true,
            provider: "brevo",
            result
          };
        } else {
          const errorText = await brevoResponse.text();
          lastError = `Brevo API error: ${errorText}`;
          console.error(`[${timestamp}] [send-booking-confirmation] Brevo failed:`, lastError);
        }
      }
      if (!RESEND_API_KEY && !BREVO_API_KEY) {
        lastError = "No email service configured (missing RESEND_API_KEY and BREVO_API_KEY)";
        console.error(`[${timestamp}] [send-booking-confirmation] ${lastError}`);
        break;
      }
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`[${timestamp}] [send-booking-confirmation] Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve)=>setTimeout(resolve, waitTime));
      }
    } catch (error) {
      lastError = error.message;
      console.error(`[${timestamp}] [send-booking-confirmation] Exception on attempt ${attempt}:`, error);
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise((resolve)=>setTimeout(resolve, waitTime));
      }
    }
  }
  return {
    success: false,
    error: lastError
  };
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [send-booking-confirmation] Function entry`);
  try {
    const { bookingId, email } = await req.json();
    console.log(`[${timestamp}] [send-booking-confirmation] Parameters - Booking ID: ${bookingId}, Email: ${email}`);
    if (!bookingId) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: Missing bookingId`);
      return new Response(JSON.stringify({
        error: "bookingId is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[${timestamp}] [send-booking-confirmation] Fetching booking #${bookingId}`);
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*, customers(*)").eq("id", bookingId).single();
    if (fetchError || !booking) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: Booking not found:`, fetchError);
      return new Response(JSON.stringify({
        error: "Booking not found",
        details: fetchError?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let serviceDetails = null;
    if (booking.plan && booking.plan.service_id) {
      const { data: service } = await supabase.from('services').select('*').eq('id', booking.plan.service_id).single();
      serviceDetails = service;
    }
    console.log(`[${timestamp}] [send-booking-confirmation] Booking fetched successfully`);
    const recipientEmail = email || booking.email;
    if (!recipientEmail) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: No email address available`);
      return new Response(JSON.stringify({
        error: "No email address available"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [send-booking-confirmation] Generating email content`);
    const emailHTML = generateEmailHTML(booking, serviceDetails);
    const subject = `Booking Confirmation #${booking.id} - U-Fill Dumpsters`;
    console.log(`[${timestamp}] [send-booking-confirmation] Sending email to ${recipientEmail}`);
    const emailResult = await sendEmailWithRetry(recipientEmail, subject, emailHTML);
    if (emailResult.success) {
      console.log(`[${timestamp}] [send-booking-confirmation] SUCCESS: Email sent via ${emailResult.provider}`);
      return new Response(JSON.stringify({
        success: true,
        message: "Confirmation email sent successfully",
        provider: emailResult.provider,
        recipient: recipientEmail
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      console.error(`[${timestamp}] [send-booking-confirmation] FAILED: All email attempts failed:`, emailResult.error);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to send confirmation email",
        details: emailResult.error
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [send-booking-confirmation] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
