import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const log = (msg, data)=>console.log(`[finalize-booking] ${msg}`, data !== undefined ? data : "");
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const paymentIntentId = body.paymentIntentId ?? body.payment_intent_id ?? null;
    if (!bookingId) {
      throw new Error("bookingId is required.");
    }
    log("Received request", {
      bookingId,
      paymentIntentId
    });
    // ----------------------------------------------------------------
    // Step 1: Fetch booking — guard against double-processing
    // ----------------------------------------------------------------
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*, customers!inner(*)").eq("id", bookingId).single();
    if (fetchError || !booking) {
      throw new Error(`Could not fetch booking ${bookingId}: ${fetchError?.message ?? "not found"}`);
    }
    // If already past pending_payment the function has already run — return early.
    if (booking.status !== "pending_payment") {
      log(`Booking ${bookingId} already finalized. Status: ${booking.status}`);
      return new Response(JSON.stringify({
        success: true,
        message: "Booking already finalized.",
        alreadyProcessed: true
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // ----------------------------------------------------------------
    // Step 2: Retrieve PaymentIntent from Stripe
    // ----------------------------------------------------------------
    let chargeId = null;
    let stripeCustomerId = null;
    let verifiedPaymentIntentId = paymentIntentId;
    if (paymentIntentId) {
      try {
        log("Retrieving PaymentIntent from Stripe…", paymentIntentId);
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: [
            "latest_charge"
          ]
        });
        log("PaymentIntent status", pi.status);
        if (pi.status !== "succeeded") {
          log("PaymentIntent not succeeded — aborting finalization", pi.status);
          return new Response(JSON.stringify({
            success: false,
            error: `Payment not completed. Stripe status: ${pi.status}`
          }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            },
            status: 402
          });
        }
        verifiedPaymentIntentId = pi.id;
        if (pi.latest_charge) {
          chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
        }
        log("Resolved chargeId", chargeId);
        const customerEmail = booking.customers?.email ?? booking.email ?? "";
        const customerName = booking.customers?.name ?? `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim();
        if (customerEmail) {
          const existingStripeId = booking.customers?.stripe_customer_id ?? null;
          if (existingStripeId) {
            stripeCustomerId = existingStripeId;
            log("Using existing Stripe customer", stripeCustomerId);
          } else {
            const existing = await stripe.customers.list({
              email: customerEmail,
              limit: 1
            });
            if (existing.data.length > 0) {
              stripeCustomerId = existing.data[0].id;
              log("Found existing Stripe customer by email", stripeCustomerId);
            } else {
              const created = await stripe.customers.create({
                email: customerEmail,
                name: customerName || undefined,
                phone: booking.customers?.phone ?? booking.phone ?? undefined,
                metadata: {
                  supabase_customer_id: String(booking.customers?.id ?? ""),
                  booking_id: String(bookingId)
                }
              });
              stripeCustomerId = created.id;
              log("Created new Stripe customer", stripeCustomerId);
            }
          }
        }
      } catch (stripeErr) {
        console.error("[finalize-booking] Stripe retrieval error:", stripeErr);
      }
    } else {
      log("No paymentIntentId provided — skipping Stripe retrieval.");
    }
    // ----------------------------------------------------------------
    // Step 3: Upsert stripe_payment_info
    // ----------------------------------------------------------------
    log("Upserting stripe_payment_info…", {
      bookingId,
      verifiedPaymentIntentId,
      chargeId,
      stripeCustomerId
    });
    const { error: paymentInfoError } = await supabase.from("stripe_payment_info").upsert({
      booking_id: bookingId,
      stripe_payment_intent_id: verifiedPaymentIntentId,
      stripe_charge_id: chargeId,
      stripe_customer_id: stripeCustomerId,
      stripe_checkout_session_id: null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "booking_id"
    });
    if (paymentInfoError) {
      console.error("[finalize-booking] stripe_payment_info upsert failed:", paymentInfoError);
    } else {
      log("stripe_payment_info upserted successfully.");
    }
    // ----------------------------------------------------------------
    // Step 4: Determine final booking status
    // ----------------------------------------------------------------
    let finalStatus = "Confirmed";
    if (booking.was_verification_skipped) {
      finalStatus = "pending_verification";
    } else if (booking.addons?.addressVerificationSkipped) {
      finalStatus = "pending_review";
    }
    log("Determined final status", finalStatus);
    // ----------------------------------------------------------------
    // Step 5: Update booking status
    // ----------------------------------------------------------------
    const { data: updatedBooking, error: updateError } = await supabase.from("bookings").update({
      status: finalStatus
    }).eq("id", bookingId).select("*, customers!inner(*)").single();
    if (updateError || !updatedBooking) {
      throw new Error(`Failed to update booking status: ${updateError?.message ?? "unknown"}`);
    }
    log("Booking status updated", finalStatus);
    // ----------------------------------------------------------------
    // Step 6: Insert equipment rental records
    // ----------------------------------------------------------------
    const addons = updatedBooking.addons ?? {};
    if (addons.equipment?.length > 0) {
      const hasDbIds = addons.equipment.every((item)=>item.dbId);
      let equipmentToInsert = [];
      if (hasDbIds) {
        equipmentToInsert = addons.equipment.map((item)=>({
            booking_id: bookingId,
            equipment_id: item.dbId,
            quantity: item.quantity
          })).filter((item)=>item.equipment_id);
      } else {
        const { data: equipmentList, error: equipmentListError } = await supabase.from("equipment").select("id, name");
        if (equipmentListError) {
          console.error("[finalize-booking] Could not fetch equipment list:", equipmentListError);
        } else {
          const equipmentMap = new Map((equipmentList ?? []).map((e)=>[
              e.name.toLowerCase().replace(/ /g, ""),
              e.id
            ]));
          equipmentToInsert = addons.equipment.map((item)=>{
            const key = item.id.toLowerCase().replace(/ /g, "");
            const equipmentId = equipmentMap.get(key);
            if (!equipmentId) {
              console.warn("[finalize-booking] No equipment match for:", item.id);
              return null;
            }
            return {
              booking_id: bookingId,
              equipment_id: equipmentId,
              quantity: item.quantity
            };
          }).filter(Boolean);
        }
      }
      if (equipmentToInsert.length > 0) {
        const { error: insertError } = await supabase.from("booking_equipment").insert(equipmentToInsert);
        if (insertError) {
          console.error("[finalize-booking] booking_equipment insert failed:", insertError);
        } else {
          log("Equipment records inserted", equipmentToInsert.length);
        }
      }
    }
    // ----------------------------------------------------------------
    // Step 7: Create customer account
    // ----------------------------------------------------------------
    log("Invoking handle-booking-account-creation…");
    const { error: accountError } = await supabase.functions.invoke("handle-booking-account-creation", {
      body: {
        customerId: updatedBooking.customer_id
      }
    });
    if (accountError) {
      console.error("[finalize-booking] handle-booking-account-creation failed:", accountError);
    } else {
      log("Account creation invoked successfully.");
    }
    // ----------------------------------------------------------------
    // Step 9: Send confirmation email
    // ----------------------------------------------------------------
    log("Invoking send-booking-confirmation…");
    const { error: emailError } = await supabase.functions.invoke("send-booking-confirmation", {
      body: {
        bookingId: updatedBooking.id
      }
    });
    if (emailError) {
      console.error("[finalize-booking] send-booking-confirmation failed:", emailError);
    } else {
      log("Confirmation email invoked successfully.");
    }
    // ----------------------------------------------------------------
    // Done
    // ----------------------------------------------------------------
    log("Finalization complete", {
      bookingId,
      finalStatus
    });
    return new Response(JSON.stringify({
      success: true,
      status: finalStatus,
      booking: updatedBooking
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[finalize-booking] CRITICAL ERROR:", error);
    return new Response(JSON.stringify({
      success: false,
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
