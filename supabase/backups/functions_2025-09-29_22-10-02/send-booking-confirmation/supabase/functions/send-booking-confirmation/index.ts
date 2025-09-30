import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
// ✅ Use the fixed list ID from your Brevo dashboard (Contacts → Lists)
const BREVO_LIST_IDS = [
  7
]; // replace with your "U-Fill Bookings" list ID
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type"
};
// --- Helper: format time safely ---
function formatTime(slot) {
  if (!slot) return "N/A";
  try {
    const [h, m] = slot.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m || 0, 0, 0);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  } catch  {
    return slot;
  }
}
// --- Helper: build booking email HTML ---
function generateBookingEmail(booking) {
  const { customers: { name, email, phone, street, city, state, zip, customer_id_text }, drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, plan, total_price, status: bookingStatus } = booking;
  const formattedDropOff = new Date(drop_off_date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  const formattedPickup = new Date(pickup_date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  const formattedDropOffTime = formatTime(drop_off_time_slot);
  const formattedPickupTime = formatTime(pickup_time_slot);
  const fullAddress = `${street}, ${city}, ${state} ${zip}`;
  const isPending = bookingStatus === "pending_verification" || bookingStatus === "pending_review";
  let rentalSpecificInfo = "";
  if (plan.id === 2 && !isPending) {
    rentalSpecificInfo = `
      <p style="font-weight: bold;">Pickup Location:</p>
      <p>227 W. Casi Way, Saratoga Springs, UT 84045</p>
      <p style="font-weight: bold;">Rental Times:</p>
      <p>Your rental is available for pickup at <strong>8:00 a.m.</strong> on the pickup date 
      and must be returned by <strong>10:00 p.m.</strong> on the return date.</p>
    `;
  } else if (plan.id !== 2) {
    rentalSpecificInfo = `
      <p style="font-weight: bold;">Delivery Address:</p>
      <p>${fullAddress}</p>
    `;
  }
  const formattedPrice = typeof total_price === "number" ? total_price.toFixed(2) : "0.00";
  const subject = isPending ? "Your U-Fill Dumpsters Booking is on Hold" : "Your U-Fill Dumpsters Booking is Confirmed!";
  const title = isPending ? "Booking on Hold" : "Booking Confirmed!";
  const mainMessage = isPending ? `Thank you for your rental. Your account has been flagged for a manual review. Please contact us at (801) 810-8832 or scheduling@u-filldumpsters.com to finish your order.` : `Thank you for your booking with U-Fill Dumpsters. Your rental is scheduled and we're excited to serve you.`;
  const portalInfo = !isPending ? `
      <div style="background-color: #fefce8; border: 1px solid #fde047; padding: 15px; margin: 20px 0; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #ca8a04;">Customer Portal Login</h3>
        <p>Use the following details to access your portal:</p>
        <p><strong>Customer ID:</strong> <span style="font-family: monospace; background-color: #e5e7eb; padding: 2px 5px; border-radius: 4px;">${customer_id_text}</span></p>
        <p><strong>Phone Number:</strong> The phone number you provided at checkout.</p>
      </div>
    ` : `
      <div style="background-color: #fff5f5; border: 1px solid #fecaca; padding: 15px; margin: 20px 0; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #b91c1c;">Action Required</h3>
        <p>Your booking requires further review. Once approved, you will receive another email with your Customer ID.</p>
        <p>Please contact support at (801) 810-8832 if you have questions.</p>
      </div>
    `;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
      <h1 style="color: ${isPending ? "#d9534f" : "#1e3a8a"}; text-align: center;">${title}</h1>
      <p>Hi ${name},</p>
      <p>${mainMessage}</p>

      ${portalInfo}

      <h2 style="color: #1e3a8a; border-bottom: 2px solid #eee; padding-bottom: 5px;">Your Booking Details:</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px; font-weight: bold;">Service:</td><td style="padding: 8px;">${plan.name}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px; font-weight: bold;">${plan.id === 2 ? "Pickup" : "Drop-off"}:</td><td style="padding: 8px;">${isPending ? "Pending Verification" : `${formattedDropOff} at ${formattedDropOffTime}`}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px; font-weight: bold;">${plan.id === 2 ? "Return" : "Pickup"}:</td><td style="padding: 8px;">${isPending ? "Pending Verification" : `${formattedPickup} by ${formattedPickupTime}`}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px; font-weight: bold;">Total Price:</td><td style="padding: 8px;">$${formattedPrice}</td></tr>
      </table>

      ${rentalSpecificInfo}

      <p style="margin-top: 20px;">If you have any questions, feel free to reply to this email or call us at (801) 810-8832.</p>
      <p style="text-align: center; margin-top: 30px;"><strong>Best regards,<br/>The U-Fill Dumpsters Team</strong></p>
    </div>
  `;
  return {
    subject,
    html
  };
}
// --- Helper: upsert contact in Brevo ---
async function upsertBrevoContact(apiKey, booking, listIds) {
  const { name, email, phone } = booking.customers ?? booking;
  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      attributes: {
        FIRSTNAME: name,
        PHONE: phone
      },
      updateEnabled: true,
      listIds
    })
  });
  if (!res.ok) {
    console.error("Brevo contact error:", res.status, await res.text());
    throw new Error(`Failed to upsert Brevo contact: ${res.status}`);
  }
  // ✅ safely parse JSON if available
  const text = await res.text();
  if (!text) {
    console.warn("Brevo contact upsert succeeded but response body was empty.");
    return {
      success: true
    };
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("Brevo returned non-JSON response:", text);
    return {
      success: true
    };
  }
}
// --- Helper: send booking email via Brevo ---
async function sendBrevoBookingEmail(apiKey, booking) {
  const { subject, html } = generateBookingEmail(booking);
  console.log("subject ", subject);
  console.log("here is the body of the email: ", html);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sender: {
        name: "U-Fill Dumpsters",
        email: "scheduling@u-filldumpsters.com"
      },
      to: [
        {
          email: booking.email,
          name: booking.name
        }
      ],
      subject,
      htmlContent: html
    })
  });
  if (!res.ok) {
    console.error("Brevo email error:", res.status, await res.text());
    throw new Error(`Failed to send booking email: ${res.status}`);
  }
  return await res.json();
}
// --- Main handler ---
serve(async (req)=>{
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Only POST allowed"
      }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    const { booking } = await req.json();
    console.log("here is the booking data ", booking);
    if (!booking?.email) {
      return new Response(JSON.stringify({
        error: "Missing booking data"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // 1. Add or update contact in Brevo
    console.log("I am about to update contact in brevo");
    await upsertBrevoContact(BREVO_API_KEY, booking, BREVO_LIST_IDS);
    // 2. Send email
    console.log("I am about to send email");
    await sendBrevoBookingEmail(BREVO_API_KEY, booking);
    console.log("I sent the email!");
    return new Response(JSON.stringify({
      message: "Booking confirmation email sent"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (e) {
    console.error("send-booking-confirmation error:", e);
    return new Response(JSON.stringify({
      error: "Failed to send confirmation",
      details: e.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
});
