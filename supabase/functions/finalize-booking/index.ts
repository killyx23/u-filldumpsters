import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20"
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const log = (msg, data)=>console.log(`[finalize-booking] ${msg}`, data !== undefined ? data : "");

async function sendBookingConfirmationEmail(bookingId: number | string, siteUrl?: string | null) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      bookingId,
      site_url: siteUrl,
    }),
  });

  let result: Record<string, unknown> = {};
  try {
    result = await response.json();
  } catch {
    result = { error: "Invalid response from send-booking-confirmation" };
  }

  if (response.ok && result.success === true) {
    return { sent: true as const, recipient: result.recipient ?? null };
  }

  const errorMessage = String(
    result.error ?? result.details ?? `HTTP ${response.status}`,
  );
  console.error("[finalize-booking] send-booking-confirmation failed:", errorMessage);
  return { sent: false as const, error: errorMessage };
}
const toPositiveInt = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
};
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const paymentIntentId = body.paymentIntentId ?? body.payment_intent_id ?? null;
    const siteUrl = body.site_url;
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
    // If already past pending_payment, run catch-up steps (email/loyalty may have failed mid-flight).
    if (booking.status !== "pending_payment") {
      log(`Booking ${bookingId} already finalized. Status: ${booking.status}. Running catch-up.`);

      let emailSent = false;
      let pointsAwarded = 0;

      const bookingTotal = Number(booking.total_price || 0);
      const { data: loyaltySettings } = await supabase
        .from("loyalty_settings")
        .select("points_per_dollar")
        .maybeSingle();
      const pointsPerDollar = Number(loyaltySettings?.points_per_dollar || 10);

      if (booking.customer_id && bookingTotal > 0) {
        const pointsToAward = Math.floor(bookingTotal * pointsPerDollar);
        if (pointsToAward > 0) {
          const { data: awardResult, error: awardError } = await supabase.rpc("adjust_loyalty_points", {
            p_customer_id: booking.customer_id,
            p_points: pointsToAward,
            p_transaction_type: "earned",
            p_booking_id: booking.id,
            p_referral_id: null,
            p_notes: "Booking completion points"
          });
          if (awardError) {
            console.error("[finalize-booking] Loyalty catch-up failed:", awardError);
          } else {
            const award = Array.isArray(awardResult) ? awardResult[0] : awardResult;
            if (!award?.already_processed) {
              pointsAwarded = pointsToAward;
            }
          }
        }
      }

      let emailError: string | null = null;
      const emailResult = await sendBookingConfirmationEmail(booking.id, siteUrl);
      if (emailResult.sent) {
        emailSent = true;
        log("Confirmation email catch-up sent successfully.");
      } else {
        emailError = emailResult.error;
      }

      if (booking.customer_id && !booking.customers?.user_id) {
        log("Invoking handle-booking-account-creation (catch-up)…");
        const { error: accountError } = await supabase.functions.invoke("handle-booking-account-creation", {
          body: { customerId: booking.customer_id },
        });
        if (accountError) {
          console.error("[finalize-booking] handle-booking-account-creation catch-up failed:", accountError);
        } else {
          log("Account creation catch-up invoked successfully.");
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "Booking already finalized.",
        alreadyProcessed: true,
        emailSent,
        emailError,
        status: booking.status,
        loyalty: {
          pointsAwarded,
          pointsRedeemed: 0,
          referralBonusAwarded: 0,
          referralApplied: false,
          referralDollarsRedeemed: 0,
          referralPendingRecorded: false
        }
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
    const verificationSkipped = Boolean(
      booking.was_verification_skipped ||
      booking.addons?.verificationSkipped ||
      booking.addons?.wasVerificationSkipped
    );
    let finalStatus = "Confirmed";
    if (verificationSkipped) {
      finalStatus = "pending_verification";
    } else if (booking.addons?.addressVerificationSkipped) {
      finalStatus = "pending_review";
    }
    log("Determined final status", finalStatus);
    // ----------------------------------------------------------------
    // Step 5: Update booking status
    // ----------------------------------------------------------------
    const bookingUpdatePayload: Record<string, unknown> = { status: finalStatus };
    if (verificationSkipped && !booking.was_verification_skipped) {
      bookingUpdatePayload.was_verification_skipped = true;
    }
    const { data: updatedBooking, error: updateError } = await supabase.from("bookings").update(bookingUpdatePayload).eq("id", bookingId).select("*, customers!inner(*)").single();
    if (updateError || !updatedBooking) {
      throw new Error(`Failed to update booking status: ${updateError?.message ?? "unknown"}`);
    }
    log("Booking status updated", finalStatus);
    // ----------------------------------------------------------------
    // Step 5b: Loyalty, coupon, and referral side effects
    // ----------------------------------------------------------------
    const loyaltyOutcome = {
      pointsAwarded: 0,
      pointsRedeemed: 0,
      referralBonusAwarded: 0,
      referralApplied: false,
      referralDollarsRedeemed: 0,
      referralPendingRecorded: false
    };
    const bookingTotal = Number(updatedBooking.total_price || 0);
    const redeemedPoints = toPositiveInt(updatedBooking.addons?.loyaltyPointsToRedeem);
    const referralCode = (updatedBooking.addons?.referralCode || updatedBooking.addons?.referral_code || "").trim();
    const couponId = Number(updatedBooking.addons?.coupon?.id || 0);
    const { data: loyaltySettings } = await supabase.from("loyalty_settings").select("points_per_dollar, referral_bonus_dollars").maybeSingle();
    const pointsPerDollar = Number(loyaltySettings?.points_per_dollar || 10);
    const referralBonusDollars = Number(loyaltySettings?.referral_bonus_dollars || 25);
    const redeemedReferralDollars = Number(
      updatedBooking.addons?.referralDollarsToRedeem ||
      updatedBooking.addons?.referral_wallet_to_redeem ||
      0
    );
    if (updatedBooking.customer_id && redeemedPoints > 0) {
      const { data: redeemResult, error: redeemError } = await supabase.rpc("adjust_loyalty_points", {
        p_customer_id: updatedBooking.customer_id,
        p_points: redeemedPoints,
        p_transaction_type: "redeemed",
        p_booking_id: updatedBooking.id,
        p_referral_id: null,
        p_notes: "Redeemed during checkout"
      });
      if (redeemError) {
        throw new Error(`Loyalty redemption failed: ${redeemError.message}`);
      }
      const redemption = Array.isArray(redeemResult) ? redeemResult[0] : redeemResult;
      if (!redemption?.already_processed) {
        loyaltyOutcome.pointsRedeemed = redeemedPoints;
      }
    }
    if (updatedBooking.customer_id && redeemedReferralDollars > 0) {
      const { data: referralRedeemResult, error: referralRedeemError } = await supabase.rpc("adjust_referral_wallet", {
        p_customer_id: updatedBooking.customer_id,
        p_amount: redeemedReferralDollars,
        p_transaction_type: "redeemed",
        p_booking_id: updatedBooking.id,
        p_referral_id: null,
        p_notes: "Redeemed during checkout"
      });
      if (referralRedeemError) {
        throw new Error(`Referral wallet redemption failed: ${referralRedeemError.message}`);
      }
      const redemption = Array.isArray(referralRedeemResult) ? referralRedeemResult[0] : referralRedeemResult;
      if (!redemption?.already_processed) {
        loyaltyOutcome.referralDollarsRedeemed = Number(redeemedReferralDollars.toFixed(2));
      }
    }
    if (updatedBooking.customer_id && bookingTotal > 0) {
      const pointsToAward = Math.floor(bookingTotal * pointsPerDollar);
      if (pointsToAward > 0) {
        const { data: awardResult, error: awardError } = await supabase.rpc("adjust_loyalty_points", {
          p_customer_id: updatedBooking.customer_id,
          p_points: pointsToAward,
          p_transaction_type: "earned",
          p_booking_id: updatedBooking.id,
          p_referral_id: null,
          p_notes: "Booking completion points"
        });
        if (awardError) {
          throw new Error(`Loyalty award failed: ${awardError.message}`);
        }
        const award = Array.isArray(awardResult) ? awardResult[0] : awardResult;
        if (!award?.already_processed) {
          loyaltyOutcome.pointsAwarded = pointsToAward;
        }
      }
    }
    if (updatedBooking.customer_id && referralCode) {
      const { data: referralResult, error: referralError } = await supabase.rpc("register_referral_for_booking", {
        p_booking_id: updatedBooking.id,
        p_referee_customer_id: updatedBooking.customer_id,
        p_referral_code: referralCode,
        p_bonus_dollars: referralBonusDollars
      });
      if (referralError) {
        console.error("[finalize-booking] Referral completion failed:", referralError);
      } else {
        const referral = Array.isArray(referralResult) ? referralResult[0] : referralResult;
        if (referral?.referral_id) {
          loyaltyOutcome.referralApplied = true;
          if (referral?.pending_recorded) {
            loyaltyOutcome.referralPendingRecorded = true;
          }
          if (referral?.already_rewarded) {
            loyaltyOutcome.referralBonusAwarded = Number(referralBonusDollars.toFixed(2));
          }
        }
      }
    }
    if (couponId > 0) {
      const { data: couponRow } = await supabase.from("coupons").select("id, usage_count").eq("id", couponId).maybeSingle();
      const nextUsage = Number(couponRow?.usage_count || 0) + 1;
      const { error: couponError } = await supabase.from("coupons").update({
        usage_count: nextUsage
      }).eq("id", couponId);
      if (couponError) {
        console.error("[finalize-booking] coupon usage increment failed:", couponError);
      }
    }
    const rewardsAddonsPatch = {
      ...(updatedBooking.addons || {}),
      loyaltyPointsEarned: Number(loyaltyOutcome.pointsAwarded || 0),
      loyaltyPointsRedeemed: Number(loyaltyOutcome.pointsRedeemed || 0),
      referralDollarsRedeemed: Number(loyaltyOutcome.referralDollarsRedeemed || 0),
      referralDollarsPending: loyaltyOutcome.referralPendingRecorded ? Number(referralBonusDollars.toFixed(2)) : Number(updatedBooking.addons?.referralDollarsPending || 0),
      rewardsSummaryUpdatedAt: new Date().toISOString(),
    };
    const { data: bookingWithRewards, error: rewardsPatchError } = await supabase
      .from("bookings")
      .update({ addons: rewardsAddonsPatch })
      .eq("id", updatedBooking.id)
      .select("*, customers!inner(*)")
      .single();
    if (rewardsPatchError) {
      console.error("[finalize-booking] rewards summary patch failed:", rewardsPatchError);
    } else if (bookingWithRewards) {
      Object.assign(updatedBooking, bookingWithRewards);
    }
    // ----------------------------------------------------------------
    // Step 5c: Notify admin chat when verification was skipped
    // ----------------------------------------------------------------
    if (finalStatus === "pending_verification") {
      const skipReason = updatedBooking.verification_notes?.trim() || "No reason provided.";
      const chatContent =
        `Driver & Vehicle Verification was skipped for Booking #${bookingId}. ` +
        `Reason: ${skipReason} ` +
        `This booking requires admin review before it can be confirmed.`;
      const { error: chatError } = await supabase.from("chat_messages").insert({
        conversation_id: `cust_${updatedBooking.customer_id}`,
        customer_id: updatedBooking.customer_id,
        booking_id: bookingId,
        sender_type: "customer",
        message_content: chatContent,
        is_read: false
      });
      if (chatError) {
        console.error("[finalize-booking] chat_messages insert failed:", chatError);
      } else {
        log("Verification skip chat message inserted.");
      }
    }
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
    log("Sending booking confirmation email…");
    let emailSent = false;
    let emailError: string | null = null;
    const emailResult = await sendBookingConfirmationEmail(updatedBooking.id, siteUrl);
    if (emailResult.sent) {
      emailSent = true;
      log("Confirmation email sent successfully.");
    } else {
      emailError = emailResult.error;
    }
    // ----------------------------------------------------------------
    // Done
    // ----------------------------------------------------------------
    log("Finalization complete", {
      bookingId,
      finalStatus,
      emailSent
    });
    return new Response(JSON.stringify({
      success: true,
      status: finalStatus,
      emailSent,
      emailError,
      booking: updatedBooking,
      loyalty: loyaltyOutcome
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
