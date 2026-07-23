import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveBookingGrandTotal } from "../_shared/resolveBookingGrandTotal.ts";
import { formatBookingTime, formatPlainBookingTime } from "../_shared/formatBookingTime.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
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
const EQUIPMENT_LABELS: Record<string, string> = {
  wheelbarrow: "Wheelbarrow",
  handTruck: "Hand Truck",
  gloves: "Working Gloves (Pair)",
  "1": "Wheelbarrow",
  "2": "Hand Truck",
  "3": "Working Gloves (Pair)",
};
const resolveEquipmentLabel = (item: { id?: string | number; dbId?: number; label?: string; name?: string }) => {
  if (item.label) return item.label;
  if (item.name) return item.name;
  const bySlug = item.id != null ? EQUIPMENT_LABELS[String(item.id)] : undefined;
  if (bySlug) return bySlug;
  const byDb = item.dbId != null ? EQUIPMENT_LABELS[String(item.dbId)] : undefined;
  if (byDb) return byDb;
  return "Equipment";
};
/** Dump Loader customer pickup (plan 2, no delivery) — matches src/utils/customerPickupService.js */
const CUSTOMER_PICKUP_PLAN_IDS = [2];

const parseJsonField = (value: unknown) => {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
};

const normalizeBookingJsonFields = (booking: { plan?: unknown; addons?: unknown }) => {
  booking.plan = parseJsonField(booking.plan);
  booking.addons = parseJsonField(booking.addons);
  return booking;
};

const isTrailerSelfService = (booking: {
  plan?: { id?: number; service_type?: string };
  addons?: { isDelivery?: boolean; deliveryService?: boolean };
  delivery_type?: string | null;
}) => {
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const isDelivery = addons.isDelivery || addons.deliveryService;
  if (isDelivery) return false;
  if (booking.delivery_type === "self_service_trailer" || booking.delivery_type === "self_pickup") {
    return true;
  }
  return CUSTOMER_PICKUP_PLAN_IDS.includes(Number(plan.id));
};

/** Merge service row into booking.plan when JSON snapshot is missing fields. */
const hydrateBookingPlanFromService = async (supabase, booking) => {
  const planId = booking.plan?.id ?? booking.plan?.service_id;
  if (!planId) return booking;
  const { data: service } = await supabase
    .from("services")
    .select("id, name, description, service_type, base_price")
    .eq("id", planId)
    .maybeSingle();
  if (!service) return booking;
  booking.plan = {
    ...booking.plan,
    id: booking.plan?.id ?? service.id,
    name: booking.plan?.name ?? service.name,
    description: booking.plan?.description ?? service.description,
    service_type: booking.plan?.service_type ?? service.service_type,
    base_price: booking.plan?.base_price ?? service.base_price,
  };
  return booking;
};
const DEFAULT_INSURANCE_PRICE = 25;
const resolveInsuranceAmount = (addons, fallbackPrice = DEFAULT_INSURANCE_PRICE) => {
  if (addons?.insurance !== "accept") return 0;
  const snap = Number(addons.insurancePriceApplied);
  if (snap > 0) return snap;
  return Number(fallbackPrice) || DEFAULT_INSURANCE_PRICE;
};
const buildPriceSummaryHTML = (booking, insuranceAmount) => {
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const basePrice = Number(plan.base_price ?? plan.price ?? 0);
  const subtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = Number(booking.tax_amount ?? 0);
  const total = resolveBookingGrandTotal(booking);
  const taxRate = Number(booking.tax_rate_used ?? 7.45);
  const loyaltyDiscountAmount = Number(addons?.loyaltyDiscountAmount ?? 0);
  const referralDiscountAmount = Number(addons?.referralDiscountAmount ?? 0);
  const couponDiscountAmount = Number(addons?.coupon?.discountAmount ?? addons?.couponDiscountAmount ?? 0);
  const couponCode = addons?.coupon?.code || null;
  const totalRewardsDiscount = Math.max(0, loyaltyDiscountAmount + referralDiscountAmount + couponDiscountAmount);
  const snapshot = Array.isArray(addons.taxLineItemsSnapshot) ? addons.taxLineItemsSnapshot : [];
  let rows = "";
  if (snapshot.length > 0) {
    for (const line of snapshot) {
      const amount = Number(line.amountAfterDiscount ?? line.amount ?? 0);
      if (amount <= 0) continue;
      const label = line.label || line.key || "Charge";
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">${label}</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(amount)}</td>
    </tr>`;
    }
  } else {
    if (basePrice > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Base Rental</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(basePrice)}</td>
    </tr>`;
    }
    if (insuranceAmount > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Rental Insurance</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(insuranceAmount)}</td>
    </tr>`;
    }
    if (addons.drivewayProtection === "accept") {
      const drivewayAmt = Number(addons.drivewayPriceApplied ?? 0);
      if (drivewayAmt > 0) {
        rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Driveway Protection</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(drivewayAmt)}</td>
    </tr>`;
      }
    }
    if (addons.deliveryFee > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Delivery Fee</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(addons.deliveryFee)}</td>
    </tr>`;
    }
    const mileageFee = addons.distanceInfo?.mileageFee ?? addons.mileageCharge ?? 0;
    if (mileageFee > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Mileage Charge</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(mileageFee)}</td>
    </tr>`;
    }
    if (addons.equipment && Array.isArray(addons.equipment)) {
      for (const item of addons.equipment) {
        const dbId = item.dbId ?? item.equipment_id;
        const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
        const qty = Number(item.quantity || 1);
        const amount = unitPrice > 0 ? unitPrice * qty : 0;
        if (amount <= 0) continue;
        rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">${resolveEquipmentLabel(item)}</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(amount)}</td>
    </tr>`;
      }
    }
  }
  if (couponDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Coupon Discount${couponCode ? ` (${couponCode})` : ""}</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(couponDiscountAmount)}</td>
    </tr>`;
  }
  if (loyaltyDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Loyalty Points Discount (${Number(addons?.loyaltyPointsToRedeem || 0)} pts)</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(loyaltyDiscountAmount)}</td>
    </tr>`;
  }
  if (referralDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Referral Wallet Discount</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(referralDiscountAmount)}</td>
    </tr>`;
  }
  const thankYouRewardsHTML = totalRewardsDiscount > 0 ? `
    <div style="margin-top: 12px; padding: 10px 12px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 8px; color: #065f46; font-size: 13px;">
      Thank you for your loyalty and continued business. Your rewards discount has been applied to this booking.
    </div>
  ` : "";
  return `
      <div style="margin-top: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Price Summary</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${rows}
          <tr style="border-top: 1px solid #e5e7eb;">
            <td style="padding: 10px 0 6px; color: #1f2937; font-weight: bold;">Subtotal</td>
            <td style="padding: 10px 0 6px; color: #1f2937; font-weight: bold; text-align: right;">${formatCurrency(subtotal)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">Tax (${taxRate.toFixed(2)}%)</td>
            <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(tax)}</td>
          </tr>
          <tr style="border-top: 2px solid #3b82f6;">
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px;">Total Paid</td>
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px; text-align: right;">${formatCurrency(total)}</td>
          </tr>
        </table>
        ${thankYouRewardsHTML}
      </div>`;
};
const generateEmailHTML = (booking, serviceDetails, insuranceAmount = 0, siteUrl = normalizeSiteUrl()) => {
  const grandTotal = resolveBookingGrandTotal(booking);
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || 'N/A';
  const phone = booking.customers?.phone || booking.phone || 'N/A';
  const rawPhone = String(phone).replace(/\D/g, '');
  console.log(` site url: ${siteUrl}`);
  const portalUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
  console.log(`portal URL: ${portalUrl}`);
  const serviceName = serviceDetails?.name || plan.name || "N/A";
  const serviceType = serviceDetails?.service_type || plan.service_type || "";
  let equipmentHTML = "";
  if (addons.equipment && addons.equipment.length > 0) {
    equipmentHTML = `
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Equipment Rental:</h3>
        <ul style="list-style: none; padding: 0;">
          ${addons.equipment.map((item)=>`
            <li style="padding: 5px 0; border-bottom: 1px solid #e5e7eb;">
              ${resolveEquipmentLabel(item)} (Quantity: ${item.quantity})
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
  const selfService = isTrailerSelfService(booking);
  console.log(
    `[send-booking-confirmation] selfService=${selfService} planId=${plan.id} serviceType=${serviceType} isDelivery=${Boolean(addons.isDelivery || addons.deliveryService)}`,
  );
  const pickupScheduleLabel = selfService ? "Pickup By:" : "Drop-off:";
  const returnScheduleLabel = selfService ? "Return By:" : "Pickup:";
  const pickupScheduleValue = selfService
    ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, { isSelfService: true, isReturnBy: false })}`
    : `${formatDate(booking.drop_off_date)} at ${formatBookingTime(booking.drop_off_time_slot)}`;
  const returnScheduleValue = selfService
    ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, { isSelfService: true, isReturnBy: true })}`
    : `${formatDate(booking.pickup_date)} by ${formatBookingTime(booking.pickup_time_slot)}`;

  const pickupDateFormatted = formatDate(booking.drop_off_date);
  const pickupStartTimeFormatted = formatBookingTime(booking.drop_off_time_slot, { isSelfService: true, isReturnBy: false });
  const returnDateFormatted = formatDate(booking.pickup_date);
  const returnByTimePlain = formatPlainBookingTime(booking.pickup_time_slot);
  const pointsEarned = Number(addons?.loyaltyPointsEarned || 0);
  const referralPendingDollars = Number(addons?.referralDollarsPending || 0);

  let nextStepsHTML = "";
  if (selfService) {
    nextStepsHTML = `
      <li><strong>🔑 Access Codes:</strong> At least 12 hours before your scheduled pickup time, you will receive a text and email with the exact location address and unlock code.</li>
      <li><strong>🗓️ Pickup:</strong> You can pick up the trailer at our location on the south side of Saratoga Springs on ${pickupDateFormatted} ${pickupStartTimeFormatted}.</li>
      <li><strong>🛻 Towing Requirements:</strong> Ensure your towing vehicle meets the minimum requirements. Your truck must have a 2-5/16 inch ball hitch.</li>
      <li><strong>📖 Safety & Operation:</strong> Follow all safety and operating instructions. Detailed operating instructions and videos can be found in the Customer Portal.</li>
      <li><strong>🪵 Usage:</strong> Fill the trailer at your convenience during your rental period.</li>
      <li><strong>⏳ Return:</strong> Return the trailer by ${returnDateFormatted} at ${returnByTimePlain}.</li>
      <li><strong>🔒 Drop-off & Security:</strong> Ensure the trailer is returned to the exact same location and is securely locked.</li>
      <li><strong>🧹 Cleaning:</strong> Ensure the trailer is empty and clean before returning it to avoid cleaning fees.</li>
     `;
  } else {
    nextStepsHTML = `
      <li>We'll arrive at your location on ${formatDate(booking.drop_off_date)} at ${formatBookingTime(booking.drop_off_time_slot)}.</li>
      <li>Our team will place the dumpster in your designated area.</li>
      <li>Fill the dumpster at your convenience during the rental period.</li>
      <li>We'll pick up the dumpster on ${formatDate(booking.pickup_date)} by ${formatBookingTime(booking.pickup_time_slot)}.</li>
     `;
  }
  return `
<!-- email-template: self-service-v2 -->
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
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${pickupScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${pickupScheduleValue}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${returnScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${returnScheduleValue}</td>
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

      ${buildPriceSummaryHTML(booking, insuranceAmount)}

      ${(pointsEarned > 0 || referralPendingDollars > 0) ? `
      <div style="margin-top: 20px; padding: 14px 16px; background-color: #ecfdf5; border: 1px solid #86efac; border-radius: 8px;">
        <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.5;">
          <strong>🎉 Rewards Update:</strong> Thank you for your booking.
          ${pointsEarned > 0 ? ` You earned <strong>${pointsEarned} loyalty points</strong> from this order.` : ''}
          ${referralPendingDollars > 0 ? ` You also have <strong>${formatCurrency(referralPendingDollars)}</strong> in pending referral rewards waiting for activation after completion rules are met.` : ''}
          Visit your Customer Portal anytime to track balances and history.
        </p>
      </div>
      ` : ""}

      <!-- Total -->
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Total Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(grandTotal)}</p>
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
        <p style="margin: 0 0 20px 0; color: #78350f; font-size: 15px; line-height: 1.5;">Access your booking details, make changes, and track your rental anytime through our Customer Portal. (Most all questions and changes can be access through the portal)</p>
        <p style="margin: 0 0 20px 0; color: #991b1b; font-size: 14px; line-height: 1.6; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 14px;"><strong>⚠️ Privacy Notice:</strong> This portal information is private and personal. Please keep this email secure and do not share your Portal ID, phone number, or access links with anyone. 🔒</p>
        
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
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [send-booking-confirmation] Function entry`);
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const email = body.email;
    const siteUrl = normalizeSiteUrl(body.site_url);
    console.log(`[${timestamp}] [send-booking-confirmation] Parameters - Booking ID: ${bookingId}, Email: ${email}, siteUrl: ${siteUrl}`);
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
    normalizeBookingJsonFields(booking);
    await hydrateBookingPlanFromService(supabase, booking);
    const serviceId = booking.plan?.id ?? booking.plan?.service_id;
    let serviceDetails = null;
    if (serviceId) {
      const { data: service } = await supabase.from("services").select("*").eq("id", serviceId).maybeSingle();
      serviceDetails = service;
    }
    console.log(`[${timestamp}] [send-booking-confirmation] Booking fetched successfully planId=${booking.plan?.id} serviceType=${booking.plan?.service_type}`);
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
    let insuranceFallbackPrice = DEFAULT_INSURANCE_PRICE;
    const { data: premiumPlan } = await supabase
      .from("protection_plans")
      .select("price")
      .eq("plan_key", "premium_insurance")
      .maybeSingle();
    if (premiumPlan?.price != null) {
      insuranceFallbackPrice = Number(premiumPlan.price);
    }
    const insuranceAmount = resolveInsuranceAmount(booking.addons, insuranceFallbackPrice);
    const emailHTML = generateEmailHTML(booking, serviceDetails, insuranceAmount, siteUrl);
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
