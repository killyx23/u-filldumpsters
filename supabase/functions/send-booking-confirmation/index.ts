import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { formatBookingTime, formatPlainBookingTime, formatDeliveryTimeWindowBetween } from "../_shared/formatBookingTime.ts";
import { parseBookingTimeSlot, businessWallTimeToUtc } from "../_shared/parseBookingTimeSlot.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";
import { isDeliveryBooking } from "../_shared/deliveryBooking.ts";

const VERIFICATION_LEAD_HOURS = 12;
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

/** Gloves and other buy-once add-ons (not inventory-returned). */
const isPurchaseEquipmentItem = (item: {
  id?: string | number;
  dbId?: number;
  equipment_id?: number;
  type?: string;
}) => {
  if (String(item.type || "").toLowerCase() === "purchase") return true;
  if (String(item.id || "").toLowerCase() === "gloves") return true;
  const numericId = Number(item.dbId ?? item.equipment_id ?? item.id);
  return Number.isFinite(numericId) && numericId === 3;
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
  if (isDeliveryBooking(booking as Record<string, unknown>)) return false;
  const plan = booking.plan || {};
  if (booking.delivery_type === "self_service_trailer" || booking.delivery_type === "self_pickup") {
    return true;
  }
  return CUSTOMER_PICKUP_PLAN_IDS.includes(Number(plan.id));
};

const CONFIRMED_STATUSES = new Set(["Confirmed", "confirmed", "Completed", "completed", "Cancelled", "cancelled"]);

const resolveActionRequiredKind = (booking: {
  status?: string | null;
  was_verification_skipped?: boolean | null;
  pending_address_verification?: boolean | null;
  addons?: Record<string, unknown> | null;
}): "pending_verification" | "pending_review" | "pending_address" | null => {
  const status = String(booking.status || "");
  const addressPending = Boolean(
    booking.pending_address_verification ||
    booking.addons?.pending_address_verification
  );
  if (addressPending && !CONFIRMED_STATUSES.has(status)) return "pending_address";
  if (status === "pending_verification") return "pending_verification";
  if (status === "pending_review") return "pending_review";
  const skipped = Boolean(
    booking.was_verification_skipped ||
    booking.addons?.verificationSkipped ||
    booking.addons?.wasVerificationSkipped
  );
  if (skipped && !CONFIRMED_STATUSES.has(status)) return "pending_verification";
  return null;
};

async function addressCancellationFeeNote(supabase, booking): Promise<string> {
  const fees: Record<string, number> = { advance_cancel_percentage: 10, late_cancel_percentage: 50 };
  const { data } = await supabase.from("charges_and_fees").select("fee_key, fee_value");
  for (const row of data || []) {
    if (row?.fee_key === "advance_cancel_percentage" || row?.fee_key === "late_cancel_percentage") {
      const value = Number(row.fee_value);
      if (Number.isFinite(value)) fees[row.fee_key] = value;
    }
  }
  const dateStr = booking.drop_off_date ? String(booking.drop_off_date) : "";
  const window = parseBookingTimeSlot(booking.drop_off_time_slot, 0);
  const start = window?.start || { hour: 8, minute: 0, second: 0 };
  const appointmentAt = dateStr ? businessWallTimeToUtc(dateStr, start) : null;
  const hoursUntil = appointmentAt ? (appointmentAt.getTime() - Date.now()) / (1000 * 60 * 60) : null;
  const isLate = hoursUntil !== null && hoursUntil <= 24;
  const percentage = isLate ? fees.late_cancel_percentage : fees.advance_cancel_percentage;
  const total = Number(booking.total_price || 0);
  const feeAmount = (percentage / 100) * total;
  return `${percentage}% (${formatCurrency(feeAmount)})`;
}

const getVerificationDeadlineInfo = (booking: {
  drop_off_date?: string | null;
  drop_off_time_slot?: string | null;
}) => {
  const dateStr = booking.drop_off_date ? String(booking.drop_off_date) : "";
  if (!dateStr) {
    return { hoursRemaining: null as number | null, isPastDeadline: false };
  }
  const window = parseBookingTimeSlot(booking.drop_off_time_slot, 0);
  const start = window?.start || { hour: 8, minute: 0, second: 0 };
  const appointmentAt = businessWallTimeToUtc(dateStr, start);
  if (!appointmentAt) {
    return { hoursRemaining: null as number | null, isPastDeadline: false };
  }
  const deadlineAt = new Date(appointmentAt.getTime() - VERIFICATION_LEAD_HOURS * 60 * 60 * 1000);
  const now = Date.now();
  const isPastDeadline = now >= deadlineAt.getTime();
  if (isPastDeadline) {
    return { hoursRemaining: 0, isPastDeadline: true };
  }
  const hoursRemaining = Math.max(1, Math.ceil((deadlineAt.getTime() - now) / (1000 * 60 * 60)));
  return { hoursRemaining, isPastDeadline: false };
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
const roundMoney = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

/** Inclusive rental days. Extra days are every day after the first. */
const rentalDayCount = (dropOff: unknown, pickup: unknown) => {
  const start = String(dropOff || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const end = String(pickup || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!start || !end) return 1;
  const startUtc = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  const endUtc = Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3]));
  return Math.max(1, Math.round((endUtc - startUtc) / 86400000) + 1);
};

const additionalDayNote = (rate: number, extraDays: number, extraDayCharge: number, qty: number) => {
  if (!(extraDays > 0) || !(rate > 0)) return "";
  const qtySuffix = qty > 1 ? ` × ${qty}` : "";
  return `Additional days: $${rate.toFixed(2)} × ${extraDays}${qtySuffix} = $${extraDayCharge.toFixed(2)}`;
};

/**
 * Rental equipment is the first day plus each later day.
 * Checkout stores that full amount on lineTotal; older rows only have the day-one price.
 */
const quoteEmailEquipment = (item, booking) => {
  const qty = Math.max(0, Number(item?.quantity || 1));
  if (isPurchaseEquipmentItem(item)) {
    const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0);
    return { amount: roundMoney(unitPrice * qty), note: "" };
  }

  const hasSnapshot = item?.lineTotal != null && item.lineTotal !== "" &&
    (item.basePrice != null || item.additionalDayPrice != null || item.additional_day_price != null);
  if (hasSnapshot) {
    const rate = roundMoney(item.additionalDayPrice ?? item.additional_day_price ?? 0);
    const extraDays = item.extraDays != null
      ? Math.max(0, Number(item.extraDays) || 0)
      : Math.max(0, (Number(item.rentalDays) || 1) - 1);
    const extraDayCharge = item.extraDayCharge != null
      ? roundMoney(item.extraDayCharge)
      : roundMoney(rate * extraDays * qty);
    return {
      amount: roundMoney(item.lineTotal),
      note: additionalDayNote(rate, extraDays, extraDayCharge, qty),
    };
  }

  const base = roundMoney(Number(item?.price ?? item?.unitPrice ?? item?.basePrice ?? 0));
  const rate = roundMoney(Number(item?.additionalDayPrice ?? item?.additional_day_price ?? 0));
  const extraDays = Math.max(0, rentalDayCount(booking?.drop_off_date, booking?.pickup_date) - 1);
  const perUnitExtra = roundMoney(rate * extraDays);
  const extraDayCharge = roundMoney(perUnitExtra * qty);
  return {
    amount: roundMoney((base + perUnitExtra) * qty),
    note: additionalDayNote(rate, extraDays, extraDayCharge, qty),
  };
};
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** Line total from the checkout snapshot when the saved equipment price was cleared. */
const snapshotEquipmentAmount = (snapshot, item) => {
  const id = String(item?.dbId ?? item?.equipment_id ?? item?.id ?? "");
  const name = String(item?.label || item?.name || "").trim().toLowerCase();
  for (const line of snapshot) {
    const key = String(line?.key || "");
    const amount = Number(line?.amount ?? 0);
    if (!(amount > 0)) continue;
    if (id && (key === `equipment_${id}` || key.endsWith(`_${id}`))) return amount;
  }
  if (!name) return 0;
  for (const line of snapshot) {
    const label = String(line?.label || "").trim().toLowerCase();
    const amount = Number(line?.amount ?? 0);
    if (amount > 0 && label && (label === name || name.includes(label) || label.includes(name))) {
      return amount;
    }
  }
  return 0;
};

const resolveReceiptPricing = (booking, insuranceAmount) => {
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const offersDrivewayProtection = Number(plan?.id) === 1;
  const snapshot = Array.isArray(addons.taxLineItemsSnapshot) ? addons.taxLineItemsSnapshot : [];
  const charges: { label: string; amount: number; note?: string }[] = [];

  const basePrice = Number(plan.price ?? plan.base_price ?? 0);
  if (basePrice > 0) charges.push({ label: "Base Rental", amount: basePrice });
  if (insuranceAmount > 0) charges.push({ label: "Premium Insurance", amount: insuranceAmount });

  if (offersDrivewayProtection && addons.drivewayProtection === "accept") {
    const drivewayAmt = Number(addons.drivewayPriceApplied ?? 0);
    if (drivewayAmt > 0) charges.push({ label: "Driveway Protection", amount: drivewayAmt });
  }
  const deliveryFee = Number(addons.deliveryFee ?? 0);
  if (deliveryFee > 0) charges.push({ label: "Delivery Fee", amount: deliveryFee });
  const mileageFee = Number(addons.distanceInfo?.mileageFee ?? addons.mileageCharge ?? 0);
  if (mileageFee > 0) charges.push({ label: "Mileage Charge", amount: mileageFee });

  if (Array.isArray(addons.equipment)) {
    for (const item of addons.equipment) {
      const quoted = quoteEmailEquipment(item, booking);
      const amount = quoted.amount > 0 ? quoted.amount : snapshotEquipmentAmount(snapshot, item);
      if (!(amount > 0)) continue;
      charges.push({
        label: resolveEquipmentLabel(item),
        amount,
        note: quoted.amount > 0 ? quoted.note : "",
      });
    }
  }

  const gross = roundMoney(charges.reduce((sum, line) => sum + line.amount, 0));
  let couponDiscountAmount = Number(
    addons?.coupon?.discountAmount ?? addons?.couponDiscountAmount ?? 0,
  );
  const coupon = addons?.coupon;
  if (!(couponDiscountAmount > 0) && coupon) {
    if (coupon.discountType === "fixed") {
      couponDiscountAmount = Number(coupon.discountValue || 0);
    } else if (coupon.discountType === "percentage") {
      couponDiscountAmount = (gross * Number(coupon.discountValue || 0)) / 100;
    }
  }
  const loyaltyDiscountAmount = Number(addons?.loyaltyDiscountAmount ?? 0);
  const referralDiscountAmount = Number(addons?.referralDiscountAmount ?? 0);
  const discount = Math.min(
    gross,
    Math.max(0, couponDiscountAmount) + Math.max(0, loyaltyDiscountAmount) + Math.max(0, referralDiscountAmount),
  );
  const appliedCoupon = Math.min(discount, Math.max(0, couponDiscountAmount));
  const appliedLoyalty = Math.min(roundMoney(discount - appliedCoupon), Math.max(0, loyaltyDiscountAmount));
  const appliedReferral = roundMoney(Math.max(0, discount - appliedCoupon - appliedLoyalty));
  const subtotal = roundMoney(Math.max(0, gross - appliedCoupon - appliedLoyalty - appliedReferral));
  const taxRate = Number(booking.tax_rate_used ?? 7.45);
  const tax = roundMoney(subtotal * (taxRate / 100));
  const total = roundMoney(subtotal + tax);

  return {
    charges,
    subtotal,
    tax,
    total,
    taxRate,
    appliedCoupon,
    appliedLoyalty,
    appliedReferral,
    couponCode: coupon?.code || null,
    loyaltyPoints: Number(addons?.loyaltyPointsToRedeem || 0),
  };
};

const buildPriceSummaryHTML = (booking, insuranceAmount) => {
  const pricing = resolveReceiptPricing(booking, insuranceAmount);
  const priceRow = (label, amount, color = "#4b5563", note = "") => {
    const noteHtml = note
      ? `<div style="margin-top: 2px; color: #6b7280; font-size: 12px;">${escapeHtml(note)}</div>`
      : "";
    return `<tr>
      <td style="padding: 6px 0; color: ${color};">${escapeHtml(label)}${noteHtml}</td>
      <td style="padding: 6px 0; color: ${color === "#4b5563" ? "#1f2937" : color}; text-align: right; vertical-align: top;">${amount < 0 ? "-" : ""}${formatCurrency(Math.abs(amount))}</td>
    </tr>`;
  };
  let rows = pricing.charges.map((line) => priceRow(line.label, line.amount, "#4b5563", line.note || "")).join("");
  if (pricing.appliedCoupon > 0) {
    rows += priceRow(
      `Coupon Discount${pricing.couponCode ? ` (${pricing.couponCode})` : ""}`,
      -pricing.appliedCoupon,
      "#047857",
    );
  }
  if (pricing.appliedLoyalty > 0) {
    rows += priceRow(
      pricing.loyaltyPoints > 0 ? `Loyalty (${pricing.loyaltyPoints} pts)` : "Loyalty",
      -pricing.appliedLoyalty,
      "#047857",
    );
  }
  if (pricing.appliedReferral > 0) {
    rows += priceRow("Referral Wallet Discount", -pricing.appliedReferral, "#047857");
  }
  const totalRewardsDiscount = pricing.appliedCoupon + pricing.appliedLoyalty + pricing.appliedReferral;
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
            <td style="padding: 10px 0 6px; color: #1f2937; font-weight: bold; text-align: right;">${formatCurrency(pricing.subtotal)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">Tax (${pricing.taxRate.toFixed(2)}%)</td>
            <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(pricing.tax)}</td>
          </tr>
          <tr style="border-top: 2px solid #3b82f6;">
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px;">Total Paid</td>
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px; text-align: right;">${formatCurrency(pricing.total)}</td>
          </tr>
        </table>
        ${thankYouRewardsHTML}
      </div>`;
};

const isInsuranceAddonLabel = (name: string) => {
  const text = String(name || "").toLowerCase();
  return text.includes("premium insurance") || /\binsurance\b/.test(text);
};

const splitInsuranceFromAddonText = (text: string) => {
  const equipment: string[] = [];
  const insurance: string[] = [];
  for (const part of String(text || "").split(/,\s*/)) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "None" || trimmed === "[]") continue;
    const name = trimmed.replace(/\s*\(qty\s*\d+\)\s*$/i, "");
    if (isInsuranceAddonLabel(name)) insurance.push(trimmed);
    else equipment.push(trimmed);
  }
  return { equipment: equipment.join(", "), insurance: insurance.join(", ") };
};

const joinAddonText = (...parts: string[]) =>
  parts.map((part) => String(part || "").trim()).filter((part) => part && part !== "None" && part !== "[]").join(", ");

const extractNoteField = (lines: string[], prefixes: string[]) => {
  for (const line of lines) {
    for (const prefix of prefixes) {
      if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
        return line.slice(prefix.length).trim();
      }
    }
  }
  return "";
};

const isChangeRequestNote = (content: string) =>
  /reschedule request|--- Structured request ---|Admin approval required|Scheduling approval required/i.test(content || "");

const specialInstructionRow = (label: string, value: string) => {
  if (!value) return "";
  return `<tr>
      <td style="padding: 8px 0; color: #6b7280; font-weight: bold; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
      <td style="padding: 8px 0; color: #1f2937;">${escapeHtml(value)}</td>
    </tr>`;
};

const buildSpecialInstructionsHTML = (notes: unknown) => {
  const raw = String(notes || "").trim();
  if (!raw) return "";
  if (!isChangeRequestNote(raw)) {
    return `
      <div style="margin-top: 25px; padding: 15px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-weight: bold;">Special Instructions:</p>
        <p style="margin: 10px 0 0 0; color: #78350f; white-space: pre-wrap;">${escapeHtml(raw)}</p>
      </div>`;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bookingMatch = raw.match(/booking\s*#?\s*(\d+)/i);
  const schedule = {
    originalDrop: "",
    originalPick: "",
    requestedDrop: "",
    requestedPick: "",
  };
  let section: "original" | "requested" | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("current schedule") || lower.startsWith("original schedule")) {
      section = "original";
      continue;
    }
    if (lower.startsWith("requested schedule") || lower.startsWith("new schedule")) {
      section = "requested";
      continue;
    }
    if (
      lower.startsWith("service:") ||
      lower.startsWith("delivery address") ||
      lower.startsWith("current add-ons") ||
      lower.startsWith("---")
    ) {
      section = null;
    }
    const drop = line.match(/^(?:Drop-off|Delivery)\s*:\s*(.+)$/i);
    const pick = line.match(/^(?:Pickup|Return|Pick-up)\s*:\s*(.+)$/i);
    if (drop && section === "original") schedule.originalDrop = drop[1].trim();
    if (drop && section === "requested") schedule.requestedDrop = drop[1].trim();
    if (pick && section === "original") schedule.originalPick = pick[1].trim();
    if (pick && section === "requested") schedule.requestedPick = pick[1].trim();
  }

  const scheduleTable = (title: string, dropOff: string, pickup: string) => {
    if (!dropOff && !pickup) return "";
    return `
      <p style="margin: 14px 0 6px; color: #1e40af; font-weight: bold;">${escapeHtml(title)}</p>
      <table style="width: 100%; border-collapse: collapse;">
        ${specialInstructionRow("Drop-off", dropOff)}
        ${specialInstructionRow("Pickup", pickup)}
      </table>`;
  };
  const address = extractNoteField(lines, ["Delivery address:", "Delivery Address:", "Contact address:", "Contact Address:"])
    .replace(/\s*\((?:pending manual verification|needs address verification)\)\s*$/i, "");
  const returned = splitInsuranceFromAddonText(extractNoteField(lines, ["Equipment to return:"]));
  const allocated = splitInsuranceFromAddonText(extractNoteField(lines, ["Equipment to allocate:"]));
  const unchanged = splitInsuranceFromAddonText(extractNoteField(lines, ["Unchanged equipment:"]));
  const insuranceRemoved = joinAddonText(returned.insurance, extractNoteField(lines, ["Insurance removed:"]));
  const insuranceAdded = joinAddonText(allocated.insurance, extractNoteField(lines, ["Insurance added:"]));
  const insuranceUnchanged = joinAddonText(unchanged.insurance, extractNoteField(lines, ["Insurance:"]));

  return `
      <div style="margin-top: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Special Instructions</h2>
        <p style="margin: 0 0 10px; color: #1e40af; font-weight: bold;">Reschedule request${bookingMatch ? ` for booking #${escapeHtml(bookingMatch[1])}` : ""}</p>
        <table style="width: 100%; border-collapse: collapse;">
          ${specialInstructionRow("Service", extractNoteField(lines, ["Service:"]))}
        </table>
        ${scheduleTable("Current schedule", schedule.originalDrop, schedule.originalPick)}
        ${scheduleTable("Requested schedule", schedule.requestedDrop, schedule.requestedPick)}
        <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
          ${specialInstructionRow("Delivery address", address)}
          ${specialInstructionRow("Distance", extractNoteField(lines, ["Distance:", "Distance (miles):"]))}
          ${specialInstructionRow("Current add-ons", extractNoteField(lines, ["Current add-ons:", "Current Add-ons:", "Original add-ons:", "Original Add-ons:"]))}
          ${specialInstructionRow("Requested add-ons", extractNoteField(lines, ["Requested add-ons:", "Requested Add-ons:"]))}
          ${specialInstructionRow("Equipment to return", returned.equipment)}
          ${specialInstructionRow("Equipment to allocate", allocated.equipment)}
          ${specialInstructionRow("Unchanged equipment", unchanged.equipment)}
          ${specialInstructionRow("Insurance removed", insuranceRemoved)}
          ${specialInstructionRow("Insurance added", insuranceAdded)}
          ${specialInstructionRow("Insurance", insuranceUnchanged)}
          ${specialInstructionRow("Comments", extractNoteField(lines, ["Customer comments:", "Customer Comments:", "Comments:"]))}
        </table>
      </div>`;
};

/** True when cancel was due to missing/improper verification (vs customer portal cancel). */
const isVerificationCancel = (cancellationDetails = {}, refundDetails = {}) => {
  const source = cancellationDetails.cancel_source;
  if (source === "verification") return true;
  if (source === "customer_portal" || source === "admin") return false;
  const reason = String(
    cancellationDetails.reason || refundDetails.reason || "",
  ).toLowerCase();
  return /verificat/.test(reason);
};

const generateRefundEmailHTML = (booking) => {
  const customerName = booking.customers?.name || booking.name || "there";
  const refundDetails = booking.refund_details || {};
  const cancellationDetails = booking.cancellation_details || {};
  const originalTotal = Number(booking.total_price || 0);
  const refundAmount = Number(
    refundDetails.amount ?? cancellationDetails.refund_amount ?? 0,
  );
  const feeAmount = Number(
    cancellationDetails.fee_amount ??
      Math.max(0, originalTotal - refundAmount),
  );
  const hoursRaw = cancellationDetails.hours_before_appointment;
  const hours =
    hoursRaw != null && hoursRaw !== ""
      ? Math.max(0, Math.round(Number(hoursRaw)))
      : null;
  const isLate =
    cancellationDetails.fee_type === "late" ||
    (hours != null && hours <= 24);
  const feeTypeLabel = isLate
    ? "Last-minute exception cancellation fee"
    : "Standard cancellation fee";
  const feePct = cancellationDetails.fee_percentage != null
    ? Number(cancellationDetails.fee_percentage)
    : null;
  const reason =
    cancellationDetails.reason ||
    refundDetails.reason ||
    null;
  const verificationCancel = isVerificationCancel(
    cancellationDetails,
    refundDetails,
  );
  const goodbyeBody = verificationCancel
    ? `We're sorry to see you go. We truly miss your business and hope that in the future you'll be able to provide the proper verification information so we can welcome you back to purchase with us again.`
    : `We're sorry to see you go. We truly miss your business and hope you'll choose U-Fill Dumpsters again whenever you need us.`;
  const goodbyeFooter = verificationCancel
    ? `Thank you for considering U-Fill Dumpsters. We hope to serve you again soon with complete verification on file.`
    : `Thank you for considering U-Fill Dumpsters. We'd love to welcome you back anytime.`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Confirmation - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Refund Confirmation</h1>
      <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 16px;">Booking #${booking.id}</p>
    </div>
    <div style="padding: 30px 20px;">
      <div style="background-color: #dbeafe; border-left: 4px solid #2563eb; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #1e3a8a; font-weight: bold;">Your cancellation has been approved and your refund has been processed.</p>
      </div>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Hi ${customerName},
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        ${goodbyeBody}
        Your cancellation for Booking #${booking.id} has been approved, and a refund of
        <strong>${formatCurrency(refundAmount)}</strong> has been processed
        ${feeAmount > 0 ? ` (cancellation fee: <strong>${formatCurrency(feeAmount)}</strong>)` : ""}.
      </p>
      <div style="margin-top: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Refund Summary</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Original Total</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${formatCurrency(originalTotal)}</td>
          </tr>
          ${hours != null ? `
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Hours before appointment</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${hours} hours</td>
          </tr>` : ""}
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Fee type</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">
              ${feeTypeLabel}${feePct != null ? ` — up to ${feePct}%` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Cancellation fee charged</td>
            <td style="padding: 8px 0; color: #b91c1c; text-align: right;">-${formatCurrency(feeAmount)}</td>
          </tr>
          <tr style="border-top: 2px solid #3b82f6;">
            <td style="padding: 12px 0 6px; color: #047857; font-weight: bold; font-size: 16px;">Amount Refunded</td>
            <td style="padding: 12px 0 6px; color: #047857; font-weight: bold; font-size: 16px; text-align: right;">${formatCurrency(refundAmount)}</td>
          </tr>
        </table>
      </div>
      ${reason ? `
      <div style="margin-top: 20px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
        <p style="margin: 0 0 6px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Note</p>
        <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.5;">${reason}</p>
      </div>` : ""}
      <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin-top: 25px;">
        Per our rental agreement, refunds are typically processed within 1–2 business days. Your bank or card issuer usually posts the credit within 5–10 business days; in rare cases it may take up to 30 days.
        If you have any questions, reply to this email or contact us through your Customer Portal.
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 13px;">${goodbyeFooter}</p>
    </div>
  </div>
</body>
</html>`;
};

const generateCancellationUnderReviewEmailHTML = (booking, feeInfo = {}) => {
  const customerName = booking.customers?.name || booking.name || "there";
  const feeType = feeInfo.fee_type || null;
  const feePct =
    feeInfo.fee_percentage != null ? Number(feeInfo.fee_percentage) : null;
  const maxFee =
    feeInfo.max_fee_amount != null || feeInfo.fee_amount != null
      ? Number(feeInfo.max_fee_amount ?? feeInfo.fee_amount)
      : null;
  const hoursRaw = feeInfo.hours_before_appointment;
  const hours =
    hoursRaw != null && hoursRaw !== ""
      ? Math.max(0, Math.round(Number(hoursRaw)))
      : null;
  const isLate = feeType === "late" || (hours != null && hours <= 24);
  const feeTypeLabel = isLate
    ? "Late cancellation (within 24 hours)"
    : "Advance cancellation (more than 24 hours)";
  const hasEstimate = feePct != null || maxFee != null;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cancellation Request Under Review - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: bold;">Cancellation Request Under Review</h1>
      <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 16px;">Booking #${booking.id}</p>
    </div>
    <div style="padding: 30px 20px;">
      <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #92400e; font-weight: bold;">We've received your cancellation request and it is currently under review.</p>
      </div>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Hi ${customerName},
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        We're sorry to see you go. Our team is reviewing your request to cancel Booking #${booking.id}
        and will process any applicable refund once it is approved.
      </p>
      <div style="margin-top: 22px; padding: 16px 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #1e3a8a; font-weight: bold; font-size: 15px;">Why cancellation fees may apply</p>
        <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; line-height: 1.6;">
          When a booking is cancelled—especially within 24 hours of the appointment—that reserved day often
          cannot be filled by another customer in time. Customers who needed that date may have to look elsewhere,
          and we lose the opportunity to rent the equipment on short notice.
        </p>
        <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; line-height: 1.6;">
          To keep scheduling fair for everyone and account for that loss of business, a cancellation fee may apply
          under our rental agreement. Last-minute cancellations are treated more strictly for this reason.
        </p>
        <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">
          If you only need a different date, <strong>rescheduling fees are substantially lower</strong> than cancelling,
          because it reduces that loss of business. You can request a reschedule anytime from your Customer Portal.
        </p>
      </div>
      ${hasEstimate ? `
      <div style="margin-top: 22px;">
        <h2 style="color: #1f2937; font-size: 18px; margin-bottom: 12px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Estimated fee for this request</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Fee category</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${feeTypeLabel}</td>
          </tr>
          ${hours != null ? `
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Hours before appointment</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${hours} hours</td>
          </tr>` : ""}
          ${feePct != null ? `
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Estimated fee</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">Up to ${feePct}%</td>
          </tr>` : ""}
          ${maxFee != null ? `
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Maximum estimated fee</td>
            <td style="padding: 8px 0; color: #b91c1c; text-align: right;">${formatCurrency(maxFee)}</td>
          </tr>` : ""}
        </table>
        <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.5;">
          Final fees are confirmed when our team completes the review.
        </p>
      </div>` : ""}
      <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin-top: 25px;">
        You'll receive another email once your cancellation is approved and any refund has been processed.
        If you have questions, reply to this email or message us through your Customer Portal.
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 13px;">Thank you for considering U-Fill Dumpsters. We hope to serve you again soon.</p>
    </div>
  </div>
</body>
</html>`;
};

const generateActionRequiredEmailHTML = (
  booking,
  serviceDetails,
  insuranceAmount = 0,
  siteUrl = normalizeSiteUrl(),
  options: {
    kind: "pending_verification" | "pending_review" | "pending_address";
    hoursRemaining: number | null;
    isPastDeadline: boolean;
    cancellationFeeNote?: string | null;
  },
) => {
  const grandTotal = resolveReceiptPricing(booking, insuranceAmount).total;
  const plan = booking.plan || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || "N/A";
  const phone = booking.customers?.phone || booking.phone || "N/A";
  const rawPhone = String(phone).replace(/\D/g, "");
  const portalUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
  const serviceName = formatCustomerFacingPlanName(serviceDetails?.name || plan.name || "N/A");
  const selfService = isTrailerSelfService(booking);
  const eventNoun = selfService ? "pickup" : "delivery";
  const customerName = booking.customers?.name || booking.name || `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "there";

  const pickupScheduleLabel = selfService ? "Pickup By:" : "Drop-off:";
  const returnScheduleLabel = selfService ? "Return By:" : "Pickup:";
  const deliveryWindowDropOff = formatDeliveryTimeWindowBetween(booking.drop_off_time_slot);
  const deliveryWindowPickup = formatDeliveryTimeWindowBetween(booking.pickup_time_slot);
  const pickupScheduleValue = selfService
    ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, { isSelfService: true, isReturnBy: false })}`
    : `${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}`;
  const returnScheduleValue = selfService
    ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, { isSelfService: true, isReturnBy: true })}`
    : `${formatDate(booking.pickup_date)} ${deliveryWindowPickup}`;

  const isVerification = options.kind === "pending_verification";
  const isAddress = options.kind === "pending_address";
  const hoursLabel = options.hoursRemaining === 1 ? "1 hour" : `${options.hoursRemaining} hours`;
  const feeNote = options.cancellationFeeNote
    ? ` You will be charged a cancellation fee of ${options.cancellationFeeNote}.`
    : " You will be charged a cancellation fee.";
  const licenseAlsoSkipped = Boolean(
    booking.was_verification_skipped ||
    booking.addons?.verificationSkipped ||
    booking.addons?.wasVerificationSkipped
  );
  const unverifiedAddress = booking.unverified_address
    || `${deliveryAddress.street || booking.street || ""}, ${deliveryAddress.city || booking.city || ""}, ${deliveryAddress.state || booking.state || ""} ${deliveryAddress.zip || booking.zip || ""}`.trim();
  const deadlineBanner = isAddress
    ? (options.isPastDeadline
      ? `The address deadline has passed. Your order will be canceled unless the address is corrected or approved.${feeNote}`
      : options.hoursRemaining != null
        ? `You have <strong>${hoursLabel}</strong> to correct this address or submit it for review. It must be done at least ${VERIFICATION_LEAD_HOURS} hours before your ${eventNoun}, or the order will be canceled and a cancellation fee will be charged.`
        : `This address must be corrected or reviewed at least ${VERIFICATION_LEAD_HOURS} hours before your ${eventNoun}, or the order will be canceled and a cancellation fee will be charged.`)
    : isVerification
    ? (options.isPastDeadline
      ? `Your verification deadline has passed. Complete this immediately or your scheduled ${eventNoun} may be delayed or cancelled.`
      : options.hoursRemaining != null
        ? `You have <strong>${hoursLabel}</strong> to finish this, or your scheduled ${eventNoun} may be delayed or you may not be able to receive your equipment.`
        : `Documents are required at least ${VERIFICATION_LEAD_HOURS} hours before your scheduled ${eventNoun}, or your ${eventNoun} may be delayed or cancelled.`)
    : "Your booking is on hold until we finish reviewing your address. We will follow up if anything else is needed.";

  const actionTitle = isAddress
    ? "Action Required — Address Needs Review"
    : isVerification
      ? "Action Required — Finish Verification"
      : "Action Required — Booking On Hold";
  const actionIntro = isAddress
    ? `We received your payment, but your booking is <strong>not confirmed yet</strong>. The address <strong>${unverifiedAddress}</strong> could not be verified and is pending until you correct it in the Customer Portal or our team approves it.${licenseAlsoSkipped ? " You also still need to submit your license plate, driver’s license (front and back), and auto insurance." : ""}`
    : isVerification
    ? "We received your payment, but your booking is <strong>not confirmed yet</strong>. You skipped driver and vehicle verification, so we still need your towing vehicle license plate, driver’s license (front and back), and auto insurance."
    : "We received your payment, but your booking is <strong>not confirmed yet</strong>. Your address still needs review before we can lock in the reservation.";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${actionTitle} - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #9a3412 0%, #f59e0b 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">${actionTitle}</h1>
      <p style="color: #fef3c7; margin: 10px 0 0 0; font-size: 16px;">Booking #${booking.id} is pending — not confirmed yet</p>
    </div>
    <div style="padding: 30px 20px;">
      <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 15px;">⚠ ${deadlineBanner}</p>
      </div>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${customerName},</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">${actionIntro}</p>
      ${isVerification ? `
      <div style="margin: 20px 0; padding: 16px 18px; background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold;">What you need to submit in the Customer Portal:</p>
        <ul style="margin: 0; padding-left: 20px; color: #7c2d12; line-height: 1.7;">
          <li>Towing vehicle license plate</li>
          <li>Driver’s license — front and back</li>
          <li>Current auto insurance document</li>
        </ul>
      </div>
      ` : ""}
      ${isAddress ? `
      <div style="margin: 20px 0; padding: 16px 18px; background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold;">What to do in the Customer Portal:</p>
        <ul style="margin: 0; padding-left: 20px; color: #7c2d12; line-height: 1.7;">
          <li>Search for the correct address and choose a Google-validated result, or</li>
          <li>Write why the address cannot be validated through Google so our team can review it</li>
        </ul>
      </div>
      ` : ""}
      <div style="text-align: center; margin: 24px 0;">
        <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Open Customer Portal</a>
      </div>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
        Once your information is submitted and approved, we will send the full booking confirmation email with next steps.
        Until then, your ${eventNoun} is not guaranteed.
      </p>
      <div style="text-align: center; margin: 24px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Booking ID</p>
        <p style="margin: 5px 0 0 0; color: #9a3412; font-size: 32px; font-weight: bold;">#${booking.id}</p>
      </div>
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #f59e0b; padding-bottom: 10px;">Customer Information</h2>
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
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #f59e0b; padding-bottom: 10px;">Service Details</h2>
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold; font-size: 16px;">${serviceName}</p>
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
      ${buildPriceSummaryHTML(booking, insuranceAmount)}
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(grandTotal)}</p>
      </div>
      <div style="margin-top: 30px; padding: 25px 20px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
        <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">🔑 Customer Portal Access</h3>
        <p style="margin: 0 0 20px 0; color: #78350f; font-size: 15px; line-height: 1.5;">Log in to finish verification, view this booking, and track status.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; max-width: 100%; border-collapse: collapse; margin: 0 0 25px 0; table-layout: fixed;">
          <tr>
            <td style="padding: 14px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; word-break: break-word;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Portal ID</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace; word-break: break-all; overflow-wrap: anywhere;">${customerIdText}</p>
            </td>
          </tr>
          <tr>
            <td style="height: 12px; font-size: 0; line-height: 12px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; word-break: break-word;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Phone Number</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace; word-break: break-all; overflow-wrap: anywhere;">${phone}</p>
            </td>
          </tr>
        </table>
        <div style="text-align: center;">
          <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Go to Customer Portal</a>
        </div>
      </div>
    </div>
    <div style="background-color: #1f2937; padding: 20px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">© 2026 U-Fill Dumpsters LLC. All rights reserved.</p>
      <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px;">This is an automated notification. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
  `;
};

const generateEmailHTML = (booking, serviceDetails, insuranceAmount = 0, siteUrl = normalizeSiteUrl()) => {
  const grandTotal = resolveReceiptPricing(booking, insuranceAmount).total;
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || 'N/A';
  const phone = booking.customers?.phone || booking.phone || 'N/A';
  const rawPhone = String(phone).replace(/\D/g, '');
  console.log(` site url: ${siteUrl}`);
  const portalUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
  console.log(`portal URL: ${portalUrl}`);
  const serviceName = formatCustomerFacingPlanName(serviceDetails?.name || plan.name || "N/A");
  const serviceType = serviceDetails?.service_type || plan.service_type || "";
  let addonsHTML = "";
  if (addons.insurance === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Hardware Protection Plan</li>`;
  }
  const offersDrivewayProtection = Number(plan?.id) === 1;
  if (offersDrivewayProtection && addons.drivewayProtection === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Driveway Protection</li>`;
  }
  const selfService = isTrailerSelfService(booking);
  console.log(
    `[send-booking-confirmation] selfService=${selfService} planId=${plan.id} serviceType=${serviceType} isDelivery=${Boolean(addons.isDelivery || addons.deliveryService)}`,
  );
  const pickupScheduleLabel = selfService ? "Pickup By:" : "Drop-off:";
  const returnScheduleLabel = selfService ? "Return By:" : "Pickup:";
  const deliveryWindowDropOff = formatDeliveryTimeWindowBetween(booking.drop_off_time_slot);
  const deliveryWindowPickup = formatDeliveryTimeWindowBetween(booking.pickup_time_slot);
  const pickupScheduleValue = selfService
    ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, { isSelfService: true, isReturnBy: false })}`
    : `${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}`;
  const returnScheduleValue = selfService
    ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, { isSelfService: true, isReturnBy: true })}`
    : `${formatDate(booking.pickup_date)} ${deliveryWindowPickup}`;

  let equipmentHTML = "";
  const equipmentList = Array.isArray(addons.equipment) ? addons.equipment : [];
  if (equipmentList.length > 0) {
    const rentalItems = equipmentList.filter((item) => !isPurchaseEquipmentItem(item));
    const purchaseItems = equipmentList.filter((item) => isPurchaseEquipmentItem(item));
    const sections: string[] = [];

    if (rentalItems.length > 0) {
      sections.push(`
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Equipment Rental:</h3>
        <ul style="list-style: none; padding: 0;">
          ${rentalItems.map((item) => `
            <li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
              <div style="color: #1f2937; font-weight: bold;">${resolveEquipmentLabel(item)} (Quantity: ${item.quantity})</div>
              <div style="margin-top: 4px; color: #6b7280; font-size: 14px;">
                <strong>Must be returned by:</strong> ${returnScheduleValue}
              </div>
            </li>
          `).join("")}
        </ul>
      </div>`);
    }

    if (purchaseItems.length > 0) {
      sections.push(`
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Purchased Items:</h3>
        <ul style="list-style: none; padding: 0;">
          ${purchaseItems.map((item) => `
            <li style="padding: 5px 0; border-bottom: 1px solid #e5e7eb;">
              ${resolveEquipmentLabel(item)} (Quantity: ${item.quantity})
            </li>
          `).join("")}
        </ul>
      </div>`);
    }

    equipmentHTML = sections.join("");
  }

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
      <li>We'll arrive at your location on ${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}.</li>
      <li>Our team will place the dumpster in your designated area.</li>
      <li>Fill the dumpster at your convenience during the rental period.</li>
      <li>We'll pick up the dumpster on ${formatDate(booking.pickup_date)} ${deliveryWindowPickup}.</li>
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
          <strong>Rewards Update:</strong> Thank you for your booking.
          ${pointsEarned > 0 ? ` You have <strong>${pointsEarned} loyalty points</strong> pending from this order. They become available after the rental is completed.` : ''}
          ${referralPendingDollars > 0 ? ` Because you were referred, you just helped a friend or family member earn a referral reward!` : ''}
          Visit your Customer Portal anytime to track your balances, where you can also invite friends and family to try our services and start earning rewards yourself.
        </p>
      </div>
      ` : ""}

      <!-- Total -->
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Total Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(grandTotal)}</p>
      </div>

      ${buildSpecialInstructionsHTML(booking.notes)}

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
        
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; max-width: 100%; border-collapse: collapse; margin: 0 0 25px 0; table-layout: fixed;">
          <tr>
            <td style="padding: 14px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; word-break: break-word;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Portal ID</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace; word-break: break-all; overflow-wrap: anywhere;">${customerIdText}</p>
            </td>
          </tr>
          <tr>
            <td style="height: 12px; font-size: 0; line-height: 12px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; word-break: break-word;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Phone Number</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace; word-break: break-all; overflow-wrap: anywhere;">${phone}</p>
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
const OWNER_ORDER_EMAIL = "brandon@u-filldumpsters.com";

const ownerOrderStatusNote = (emailKind: string) => {
  if (emailKind === "pending_verification") return "Paid — customer still needs to finish verification";
  if (emailKind === "pending_address") return "Paid — address needs to be fixed";
  if (emailKind === "pending_review") return "Paid — booking is on hold for review";
  return "Paid and confirmed";
};

const notifyOwnerOfPaidOrder = async (
  supabase,
  booking,
  serviceDetails,
  insuranceAmount,
  siteUrl,
  emailKind: string,
) => {
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("bookings")
    .update({ owner_order_notified_at: claimedAt })
    .eq("id", booking.id)
    .is("owner_order_notified_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[send-booking-confirmation] Owner order notice claim failed:", claimError);
    return { sent: false, error: claimError.message };
  }
  if (!claimed) {
    return { sent: false, skipped: true, reason: "already_notified" };
  }

  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerName = booking.name || `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Unknown";
  const phone = booking.customers?.phone || booking.phone || "N/A";
  const customerEmail = booking.email || "N/A";
  const serviceName = formatCustomerFacingPlanName(serviceDetails?.name || plan.name || "N/A");
  const selfService = isTrailerSelfService(booking);
  const pickupScheduleLabel = selfService ? "Pickup by" : "Drop-off";
  const returnScheduleLabel = selfService ? "Return by" : "Pickup";
  const pickupScheduleValue = selfService
    ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, { isSelfService: true, isReturnBy: false })}`
    : `${formatDate(booking.drop_off_date)} ${formatDeliveryTimeWindowBetween(booking.drop_off_time_slot)}`;
  const returnScheduleValue = selfService
    ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, { isSelfService: true, isReturnBy: true })}`
    : `${formatDate(booking.pickup_date)} ${formatDeliveryTimeWindowBetween(booking.pickup_time_slot)}`;
  const street = deliveryAddress.street || booking.street || "";
  const city = deliveryAddress.city || booking.city || "";
  const state = deliveryAddress.state || booking.state || "";
  const zip = deliveryAddress.zip || booking.zip || "";
  const address = [street, [city, state].filter(Boolean).join(", "), zip].filter(Boolean).join(" ") || "N/A";
  const pricing = resolveReceiptPricing(booking, insuranceAmount);
  const charged = Number(booking.total_price);
  const amountPaid = Number.isFinite(charged) && charged > 0 ? charged : pricing.total;
  const equipment = Array.isArray(addons.equipment) ? addons.equipment : [];
  const extraLines = [
    ...equipment.map((item) => `${resolveEquipmentLabel(item)} × ${item.quantity || 1}`),
    addons.insurance === "accept" ? "Hardware Protection Plan" : "",
    addons.drivewayProtection === "accept" ? "Driveway Protection" : "",
  ].filter(Boolean);
  const chargeRows = pricing.charges
    .map((line) => `<tr><td style="padding:4px 12px 4px 0;color:#4b5563;">${escapeHtml(line.label)}</td><td style="padding:4px 0;text-align:right;">${formatCurrency(line.amount)}</td></tr>`)
    .join("");
  const adminUrl = `${siteUrl}/admin/customer/${encodeURIComponent(String(booking.customer_id || ""))}`;
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f3f4f6;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e3a8a;color:#ffffff;padding:24px;">
      <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">New paid order</p>
      <h1 style="margin:8px 0 0;font-size:28px;">Order #${escapeHtml(booking.id)}</h1>
      <p style="margin:8px 0 0;color:#bfdbfe;">${escapeHtml(ownerOrderStatusNote(emailKind))}</p>
    </div>
    <div style="padding:24px;color:#1f2937;line-height:1.5;">
      <p style="margin:0 0 8px;"><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
      <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
      <p style="margin:0 0 8px;"><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p style="margin:0 0 8px;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
      <p style="margin:0 0 8px;"><strong>Fulfillment:</strong> ${selfService ? "Customer pickup" : "Delivery"}</p>
      <p style="margin:0 0 8px;"><strong>${escapeHtml(pickupScheduleLabel)}:</strong> ${escapeHtml(pickupScheduleValue)}</p>
      <p style="margin:0 0 8px;"><strong>${escapeHtml(returnScheduleLabel)}:</strong> ${escapeHtml(returnScheduleValue)}</p>
      <p style="margin:0 0 16px;"><strong>Address:</strong> ${escapeHtml(address)}</p>
      ${extraLines.length ? `<p style="margin:0 0 8px;"><strong>Also included:</strong> ${escapeHtml(extraLines.join(", "))}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin:12px 0 16px;">${chargeRows}</table>
      <p style="margin:0 0 20px;font-size:20px;"><strong>Amount paid:</strong> ${formatCurrency(amountPaid)}</p>
      <a href="${adminUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:6px;">Open this customer in admin</a>
    </div>
  </div>
</body></html>`;

  const result = await sendEmail(
    OWNER_ORDER_EMAIL,
    `New paid order #${booking.id} — ${customerName}`,
    html,
  );
  if (!result.success) {
    await supabase
      .from("bookings")
      .update({ owner_order_notified_at: null })
      .eq("id", booking.id)
      .eq("owner_order_notified_at", claimedAt);
    console.error("[send-booking-confirmation] Owner order notice failed:", result.error);
    return { sent: false, error: result.error || "send failed" };
  }
  console.log(`[send-booking-confirmation] Owner order notice sent to ${OWNER_ORDER_EMAIL} for #${booking.id}`);
  return { sent: true, recipient: OWNER_ORDER_EMAIL };
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

const buildReferrerThankYouEmailHTML = ({
  referrerName,
  bonusDollars,
  bookingId,
  customerIdText,
  phoneDisplay,
  loginUrl,
}) => {
  const safeName = referrerName || "Valued Customer";
  const amount = formatCurrency(Number(bonusDollars || 0));
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You for Your Referral</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #065f46 0%, #10b981 100%); padding: 32px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Thank You for Your Referral</h1>
      <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 15px;">A friend or family member just booked with your link</p>
    </div>
    <div style="padding: 28px 22px; color: #1f2937; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">Hello ${safeName},</p>
      <p style="margin: 0 0 16px 0;">
        Thank you for referring someone to U-Fill Dumpsters. We appreciate your trust and support.
      </p>
      <p style="margin: 0 0 16px 0;">
        A <strong>${amount}</strong> referral reward has been added to your account as
        <strong>pending</strong> for referred booking <strong>#${bookingId}</strong>.
        Once that rental is marked <strong>Completed</strong>, the reward will become available
        in your Customer Portal for use on a future booking.
      </p>
      <div style="background-color: #f0f8ff; border: 1px solid #cce5ff; padding: 14px 16px; border-radius: 6px; margin: 20px 0; font-family: monospace; font-size: 14px;">
        <strong>Customer ID:</strong> ${customerIdText || "N/A"}<br>
        <strong>Phone Number (Password):</strong> ${phoneDisplay || "N/A"}
      </div>
      <p style="margin: 0 0 20px 0;">
        Use the button below to open the Customer Portal with your details pre-filled.
        You can track pending and available referral rewards under Welcome.
      </p>
      <p style="text-align: center; margin: 0 0 24px 0;">
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: #000000 !important; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Open Customer Portal
        </a>
      </p>
      <p style="margin: 0; font-size: 13px; color: #6b7280;">
        If the button does not work, copy and paste this link into your browser:<br>
        <a href="${loginUrl}" style="color: #1d4ed8; word-break: break-all;">${loginUrl}</a>
      </p>
    </div>
    <div style="background-color: #1f2937; padding: 18px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832</p>
      <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">support@u-filldumpsters.com</p>
    </div>
  </div>
</body>
</html>
  `;
};

const sendReferrerThankYouEmail = async (supabase, booking, siteUrl, timestamp) => {
  try {
    const addons = booking?.addons && typeof booking.addons === "object" ? booking.addons : {};
    const pendingDollars = Number(addons.referralDollarsPending || 0);
    if (!(pendingDollars > 0)) {
      return { sent: false, skipped: true, reason: "no_pending_referral_dollars" };
    }

    const referralCode = String(addons.referralCode || addons.referral_code || "").trim();
    if (!referralCode) {
      return { sent: false, skipped: true, reason: "missing_referral_code" };
    }

    const { data: referralRow, error: referralError } = await supabase
      .from("referrals")
      .select("id, referrer_customer_id, referral_code, status")
      .ilike("referral_code", referralCode)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (referralError || !referralRow?.referrer_customer_id) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer lookup failed:`, referralError);
      return { sent: false, skipped: false, reason: "referrer_not_found" };
    }

    const { data: referrer, error: referrerError } = await supabase
      .from("customers")
      .select("id, name, email, phone, customer_id_text")
      .eq("id", referralRow.referrer_customer_id)
      .maybeSingle();

    if (referrerError || !referrer?.email) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer customer fetch failed:`, referrerError);
      return { sent: false, skipped: false, reason: "referrer_email_missing" };
    }

    const rawPhone = String(referrer.phone || "").replace(/\D/g, "");
    const customerIdText = referrer.customer_id_text || "";
    if (!customerIdText || rawPhone.length < 10) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer missing portal login credentials`);
      return { sent: false, skipped: false, reason: "referrer_login_incomplete" };
    }

    const loginUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
    const html = buildReferrerThankYouEmailHTML({
      referrerName: referrer.name,
      bonusDollars: pendingDollars,
      bookingId: booking.id,
      customerIdText,
      phoneDisplay: referrer.phone,
      loginUrl,
    });
    const subject = "Thank you for your referral – reward pending";
    const emailResult = await sendEmailWithRetry(referrer.email, subject, html);
    if (emailResult.success) {
      console.log(`[${timestamp}] [send-booking-confirmation] Referrer thank-you sent to ${referrer.email} via ${emailResult.provider}`);
      return { sent: true, recipient: referrer.email, provider: emailResult.provider };
    }

    console.error(`[${timestamp}] [send-booking-confirmation] Referrer thank-you failed:`, emailResult.error);
    return { sent: false, skipped: false, reason: emailResult.error || "send_failed" };
  } catch (err) {
    console.error(`[${timestamp}] [send-booking-confirmation] Referrer thank-you exception:`, err);
    return { sent: false, skipped: false, reason: err?.message || "exception" };
  }
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
    const force = body.force === true || body.force_resend === true;
    console.log(`[${timestamp}] [send-booking-confirmation] Parameters - Booking ID: ${bookingId}, Email: ${email}, siteUrl: ${siteUrl}, force: ${force}`);
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

    // PIN email (issued ~12h before pickup). Delivery bookings never get a padlock code.
    const emailType = body.email_type || body.emailType || "confirmation";
    if (emailType === "pin_update" || emailType === "pin_reminder") {
      if (isDeliveryBooking(booking)) {
        console.log(`[${timestamp}] [send-booking-confirmation] Skipping ${emailType} for delivery booking #${booking.id}`);
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          skippedReason: "delivery",
          email_type: emailType,
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
        });
      }
    }
    if (emailType === "pin_update") {
      const pin = body.pin || body.access_pin;
      if (!pin) {
        return new Response(JSON.stringify({ error: "pin is required for pin_update" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const pickupDateLabel = formatDate(booking.drop_off_date);
      const pickupTimeLabel = formatPlainBookingTime(booking.drop_off_time_slot) || booking.drop_off_time_slot || "";
      const returnDateLabel = formatDate(booking.pickup_date);
      const returnTimeLabel = formatPlainBookingTime(booking.pickup_time_slot) || booking.pickup_time_slot || "";
      const activationLabel = pickupTimeLabel
        ? `${pickupDateLabel} at ${pickupTimeLabel}`
        : pickupDateLabel;
      const pinHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e3a8a;color:#fff;padding:20px 24px;">
      <h1 style="margin:0;font-size:22px;">Your Access Code — Order #${booking.id}</h1>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${booking.name || "there"},</p>
      <p>Your Dump Trailer access code is ready. Enter it on the padlock at pickup.</p>
      <div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
        <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Access PIN</p>
        <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${pin}</p>
      </div>
      <p><strong>Activates:</strong> ${activationLabel}</p>
      <p><strong>Return by:</strong> ${returnDateLabel}${returnTimeLabel ? ` at ${returnTimeLabel}` : ""}</p>
      <p style="color:#6b7280;font-size:13px;">The code works during your scheduled rental window. Have everything loaded and locked by your return time.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${siteUrl}/customer-portal?tab=access-codes" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">View in Customer Portal</a>
      </p>
    </div>
  </div>
</body></html>`;
      const pinSubject = `Your Access Code for Order #${booking.id} — U-Fill Dumpsters`;
      console.log(`[${timestamp}] [send-booking-confirmation] Sending pin_update to ${recipientEmail}`);
      const pinResult = await sendEmailWithRetry(recipientEmail, pinSubject, pinHtml);
      if (!pinResult.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to send PIN email",
          details: pinResult.error,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // SMS companion (respects customers.sms_opt_in). Email success is enough to mark notified.
      const phone = booking.customers?.phone || booking.phone || "";
      const smsOptIn = booking.customers?.sms_opt_in !== false;
      const smsContent =
        `U-Fill Dumpsters: Your access PIN for Order #${booking.id} is ${pin}. ` +
        `Activates ${activationLabel}. View: ${siteUrl}/customer-portal?tab=access-codes`;
      const smsResult = await sendSms(phone, smsContent, { smsOptIn });
      console.log(`[${timestamp}] [send-booking-confirmation] pin_update SMS:`, smsResult);

      const notifiedAt = new Date().toISOString();
      await supabase.from("bookings").update({ pin_notification_sent_at: notifiedAt }).eq("id", booking.id);
      await supabase
        .from("rental_access_codes")
        .update({ notified_at: notifiedAt })
        .eq("order_id", booking.id)
        .eq("status", "active");
      return new Response(JSON.stringify({
        success: true,
        message: "PIN email sent successfully",
        provider: pinResult.provider,
        recipient: recipientEmail,
        email_type: "pin_update",
        sms: smsResult,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (emailType === "pin_reminder") {
      const pin = body.pin || body.access_pin;
      if (!pin) {
        return new Response(JSON.stringify({ error: "pin is required for pin_reminder" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const pickupDateLabel = formatDate(booking.drop_off_date);
      const pickupTimeLabel = formatPlainBookingTime(booking.drop_off_time_slot) || booking.drop_off_time_slot || "";
      const whenLabel = pickupTimeLabel ? `${pickupDateLabel} at ${pickupTimeLabel}` : pickupDateLabel;
      const reminderHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e3a8a;color:#fff;padding:20px 24px;">
      <h1 style="margin:0;font-size:22px;">Pickup in about an hour — Order #${booking.id}</h1>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${booking.name || "there"},</p>
      <p>Reminder: your Dump Trailer pickup is around <strong>${whenLabel}</strong>. Your padlock code:</p>
      <div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
        <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Access PIN</p>
        <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${pin}</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${siteUrl}/customer-portal?tab=access-codes" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">View in Customer Portal</a>
      </p>
    </div>
  </div>
</body></html>`;
      const reminderSubject = `Pickup soon — Order #${booking.id} access code — U-Fill Dumpsters`;
      console.log(`[${timestamp}] [send-booking-confirmation] Sending pin_reminder to ${recipientEmail}`);
      const reminderResult = await sendEmailWithRetry(recipientEmail, reminderSubject, reminderHtml);
      if (!reminderResult.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to send PIN reminder email",
          details: reminderResult.error,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const phone = booking.customers?.phone || booking.phone || "";
      const smsOptIn = booking.customers?.sms_opt_in !== false;
      const smsContent =
        `U-Fill Dumpsters: Pickup in about an hour for Order #${booking.id}. Your access PIN is ${pin}. ` +
        `View: ${siteUrl}/customer-portal?tab=access-codes`;
      const smsResult = await sendSms(phone, smsContent, { smsOptIn });
      console.log(`[${timestamp}] [send-booking-confirmation] pin_reminder SMS:`, smsResult);
      const remindedAt = new Date().toISOString();
      await supabase.from("bookings").update({ pin_reminder_sent_at: remindedAt }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: true,
        message: "PIN reminder sent successfully",
        provider: reminderResult.provider,
        recipient: recipientEmail,
        email_type: "pin_reminder",
        sms: smsResult,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (emailType === "cancellation_under_review") {
      let feeInfo = body.fee_info || body.feeInfo || null;
      if (!feeInfo || typeof feeInfo !== "object") {
        const { data: pendingLog } = await supabase
          .from("reschedule_history_logs")
          .select(
            "fee_type, fee_percentage, fee_amount, hours_before_appointment",
          )
          .eq("booking_id", bookingId)
          .eq("request_type", "cancellation")
          .eq("request_status", "pending")
          .order("reschedule_request_time", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pendingLog) {
          feeInfo = {
            fee_type: pendingLog.fee_type,
            fee_percentage: pendingLog.fee_percentage,
            max_fee_amount: pendingLog.fee_amount,
            hours_before_appointment: pendingLog.hours_before_appointment,
          };
        } else {
          feeInfo = {};
        }
      }
      const underReviewHtml = generateCancellationUnderReviewEmailHTML(
        booking,
        feeInfo,
      );
      const underReviewSubject =
        `Cancellation Request Under Review #${booking.id} — U-Fill Dumpsters`;
      console.log(
        `[${timestamp}] [send-booking-confirmation] Sending cancellation_under_review to ${recipientEmail}`,
      );
      const underReviewResult = await sendEmailWithRetry(
        recipientEmail,
        underReviewSubject,
        underReviewHtml,
      );
      if (!underReviewResult.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to send cancellation under review email",
          details: underReviewResult.error,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        message: "Cancellation under review email sent successfully",
        provider: underReviewResult.provider,
        recipient: recipientEmail,
        email_type: "cancellation_under_review",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    const receiptPricing = resolveReceiptPricing(booking, insuranceAmount);
    console.log(
      `[${timestamp}] [send-booking-confirmation] Generating email content subtotal=${receiptPricing.subtotal} tax=${receiptPricing.tax} total=${receiptPricing.total} lines=${receiptPricing.charges.map((line) => `${line.label}:${line.amount}`).join(",")}`,
    );
    const isCancelledRefund =
      booking.status === "Cancelled" &&
      (booking.refund_details || booking.cancellation_details);
    const actionRequiredKind = isCancelledRefund ? null : resolveActionRequiredKind(booking);
    const deadlineInfo = actionRequiredKind === "pending_verification" || actionRequiredKind === "pending_address"
      ? getVerificationDeadlineInfo(booking)
      : { hoursRemaining: null as number | null, isPastDeadline: false };
    const cancellationFeeNote = actionRequiredKind === "pending_address" && deadlineInfo.isPastDeadline
      ? await addressCancellationFeeNote(supabase, booking)
      : null;
    const emailKind = isCancelledRefund
      ? "refund"
      : actionRequiredKind || "confirmation";

    // Send-once claim for normal confirmation emails (not pin/refund/action-required).
    // force=true (explicit resend) bypasses the claim.
    let confirmationClaimAt: string | null = null;
    if (emailKind === "confirmation" && !force) {
      confirmationClaimAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ confirmation_email_sent_at: confirmationClaimAt })
        .eq("id", booking.id)
        .is("confirmation_email_sent_at", null)
        .select("id")
        .maybeSingle();

      if (claimError) {
        console.error(`[${timestamp}] [send-booking-confirmation] Claim failed:`, claimError);
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to claim confirmation email send",
          details: claimError.message,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!claimed) {
        console.log(`[${timestamp}] [send-booking-confirmation] Already sent for booking #${booking.id}; skipping`);
        return new Response(JSON.stringify({
          success: true,
          already_sent: true,
          message: "Confirmation email already sent",
          recipient: recipientEmail,
          email_type: "confirmation",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const emailHTML = isCancelledRefund
      ? generateRefundEmailHTML(booking)
      : actionRequiredKind
        ? generateActionRequiredEmailHTML(booking, serviceDetails, insuranceAmount, siteUrl, {
          kind: actionRequiredKind,
          hoursRemaining: deadlineInfo.hoursRemaining,
          isPastDeadline: deadlineInfo.isPastDeadline,
          cancellationFeeNote,
        })
        : generateEmailHTML(booking, serviceDetails, insuranceAmount, siteUrl);
    const subject = isCancelledRefund
      ? `Refund Confirmation #${booking.id} — U-Fill Dumpsters`
      : actionRequiredKind === "pending_verification"
        ? `Action Required: Finish verification for Booking #${booking.id} — U-Fill Dumpsters`
        : actionRequiredKind === "pending_address"
          ? `Action Required: Address needs to be fixed for Booking #${booking.id} — U-Fill Dumpsters`
        : actionRequiredKind === "pending_review"
          ? `Action Required: Booking #${booking.id} is on hold — U-Fill Dumpsters`
          : `Booking Confirmation #${booking.id} - U-Fill Dumpsters`;
    console.log(`[${timestamp}] [send-booking-confirmation] Sending email to ${recipientEmail} (type=${emailKind})`);
    const emailResult = await sendEmailWithRetry(recipientEmail, subject, emailHTML);
    if (emailResult.success) {
      console.log(`[${timestamp}] [send-booking-confirmation] SUCCESS: Email sent via ${emailResult.provider}`);
      if (emailKind === "confirmation" && force) {
        await supabase
          .from("bookings")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
      }
      const referrerEmailResult = isCancelledRefund || actionRequiredKind || force
        ? {
          skipped: true,
          reason: isCancelledRefund
            ? "cancelled_refund"
            : actionRequiredKind
              ? "action_required"
              : "forced_resend",
        }
        : await sendReferrerThankYouEmail(supabase, booking, siteUrl, timestamp);
      const ownerOrderNotice = isCancelledRefund
        ? { sent: false, skipped: true, reason: "cancelled_refund" }
        : await notifyOwnerOfPaidOrder(
          supabase,
          booking,
          serviceDetails,
          insuranceAmount,
          siteUrl,
          emailKind,
        );
      return new Response(JSON.stringify({
        success: true,
        message: isCancelledRefund
          ? "Refund confirmation email sent successfully"
          : actionRequiredKind
            ? "Action-required email sent successfully"
            : "Confirmation email sent successfully",
        provider: emailResult.provider,
        recipient: recipientEmail,
        email_type: emailKind,
        referrerThankYou: referrerEmailResult,
        ownerOrderNotice,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      if (confirmationClaimAt) {
        await supabase
          .from("bookings")
          .update({ confirmation_email_sent_at: null })
          .eq("id", booking.id)
          .eq("confirmation_email_sent_at", confirmationClaimAt);
      }
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
