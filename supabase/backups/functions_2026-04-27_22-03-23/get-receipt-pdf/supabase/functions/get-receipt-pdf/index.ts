import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import { format } from 'https://deno.land/std@0.208.0/datetime/mod.ts';
const formatDate = (dateStr)=>dateStr ? format(new Date(dateStr), 'MM/dd/yyyy') : 'N/A';
const formatCurrency = (amount)=>amount != null ? `$${Number(amount).toFixed(2)}` : '$0.00';
const drawDivider = (page, y, margin, pageWidth, color)=>{
  page.drawLine({
    start: {
      x: margin,
      y
    },
    end: {
      x: pageWidth - margin,
      y
    },
    thickness: 0.5,
    color
  });
};
async function generatePDFReceipt(booking) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([
    612,
    792
  ]); // US Letter
  const { width, height } = page.getSize();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const col2X = width - margin - 160;
  const navy = rgb(0, 0.2, 0.4);
  const gray = rgb(0.5, 0.5, 0.5);
  const lightGray = rgb(0.85, 0.85, 0.85);
  const black = rgb(0, 0, 0);
  const green = rgb(0, 0.5, 0.2);
  const red = rgb(0.7, 0, 0);
  let y = height - margin;
  const drawText = (text, x, yPos, { font = fontRegular, size = 10, color = black, align = 'left' } = {})=>{
    const textWidth = font.widthOfTextAtSize(text, size);
    const drawX = align === 'right' ? x - textWidth : x;
    page.drawText(text, {
      x: drawX,
      y: yPos,
      size,
      font,
      color
    });
    return textWidth;
  };
  // ── Header ──────────────────────────────────────────────────────────
  drawText('U-Fill Dumpsters', margin, y, {
    font: fontBold,
    size: 26,
    color: navy
  });
  drawText('RECEIPT', width - margin, y, {
    font: fontBold,
    size: 20,
    color: navy,
    align: 'right'
  });
  y -= 18;
  drawText('Saratoga Springs, UT  |  (801) 810-8832', margin, y, {
    size: 9,
    color: gray
  });
  drawText(`Receipt #: ${booking.id}`, width - margin, y, {
    size: 9,
    color: gray,
    align: 'right'
  });
  y -= 14;
  drawText('u-filldumpsters.com', margin, y, {
    size: 9,
    color: gray
  });
  drawText(`Date: ${formatDate(booking.created_at)}`, width - margin, y, {
    size: 9,
    color: gray,
    align: 'right'
  });
  y -= 14;
  const statusColor = booking.status === 'confirmed' ? green : booking.status?.includes('pending') ? red : gray;
  drawText(`Status: ${(booking.status || 'N/A').replace(/_/g, ' ').toUpperCase()}`, width - margin, y, {
    font: fontBold,
    size: 9,
    color: statusColor,
    align: 'right'
  });
  y -= 20;
  drawDivider(page, y, margin, width, navy);
  // ── Billed To ────────────────────────────────────────────────────────
  y -= 20;
  drawText('BILLED TO', margin, y, {
    font: fontBold,
    size: 9,
    color: gray
  });
  y -= 14;
  drawText(booking.customers?.name || 'N/A', margin, y, {
    font: fontBold,
    size: 11,
    color: black
  });
  y -= 14;
  drawText(booking.customers?.email || 'N/A', margin, y, {
    size: 10,
    color: black
  });
  y -= 14;
  drawText(booking.customers?.phone || 'N/A', margin, y, {
    size: 10,
    color: black
  });
  const street = booking.customers?.street || booking.street || '';
  const city = booking.customers?.city || booking.city || '';
  const state = booking.customers?.state || booking.state || '';
  const zip = booking.customers?.zip || booking.zip || '';
  if (street) {
    y -= 14;
    drawText(`${street}, ${city}, ${state} ${zip}`, margin, y, {
      size: 10,
      color: black
    });
  }
  // ── Service Details ───────────────────────────────────────────────────
  y -= 30;
  drawDivider(page, y, margin, width, lightGray);
  y -= 16;
  // Table header
  page.drawRectangle({
    x: margin,
    y: y - 4,
    width: width - margin * 2,
    height: 18,
    color: navy
  });
  drawText('SERVICE DETAILS', margin + 6, y, {
    font: fontBold,
    size: 9,
    color: rgb(1, 1, 1)
  });
  drawText('AMOUNT', width - margin, y, {
    font: fontBold,
    size: 9,
    color: rgb(1, 1, 1),
    align: 'right'
  });
  y -= 22;
  const serviceName = (booking.plan?.name || 'Service') + (booking.addons?.isDelivery ? ' with Delivery' : '');
  const dropOff = formatDate(booking.drop_off_date);
  const pickup = formatDate(booking.pickup_date);
  drawText(serviceName, margin, y, {
    font: fontBold,
    size: 10,
    color: black
  });
  drawText(formatCurrency(booking.plan?.price || 0), width - margin, y, {
    size: 10,
    align: 'right'
  });
  y -= 14;
  drawText(`Drop-off: ${dropOff}  (${booking.drop_off_time_slot || 'N/A'})`, margin + 10, y, {
    size: 9,
    color: gray
  });
  y -= 12;
  drawText(`Pick-up:  ${pickup}  (${booking.pickup_time_slot || 'N/A'})`, margin + 10, y, {
    size: 9,
    color: gray
  });
  // ── Fees ──────────────────────────────────────────────────────────────
  const fees = [];
  if (booking.addons?.deliveryFee) fees.push({
    name: 'Delivery Fee',
    amount: booking.addons.deliveryFee
  });
  if (booking.addons?.fuelSurcharge) fees.push({
    name: 'Fuel Surcharge',
    amount: booking.addons.fuelSurcharge
  });
  if (booking.addons?.protectionPlan) fees.push({
    name: 'Damage Protection',
    amount: booking.addons.protectionPlan
  });
  for (const fee of fees){
    y -= 20;
    drawDivider(page, y + 8, margin, width, lightGray);
    drawText(fee.name, margin, y, {
      size: 10,
      color: black
    });
    drawText(formatCurrency(fee.amount), width - margin, y, {
      size: 10,
      align: 'right'
    });
  }
  // ── Coupon ────────────────────────────────────────────────────────────
  const coupon = booking.addons?.coupon;
  if (coupon?.isValid) {
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'percentage') {
      discountAmount = (booking.plan?.price || 0) * (coupon.discountValue / 100);
    }
    y -= 20;
    drawDivider(page, y + 8, margin, width, lightGray);
    drawText(`Coupon (${coupon.code})`, margin, y, {
      size: 10,
      color: green
    });
    drawText(`-${formatCurrency(discountAmount)}`, width - margin, y, {
      size: 10,
      color: green,
      align: 'right'
    });
  }
  // ── Totals ────────────────────────────────────────────────────────────
  y -= 10;
  drawDivider(page, y, margin, width, navy);
  const tax = (booking.total_price || 0) / 1.06 * 0.06;
  const basePrice = (booking.total_price || 0) - tax;
  y -= 18;
  drawText('Subtotal:', col2X, y, {
    size: 10,
    color: gray
  });
  drawText(formatCurrency(basePrice), width - margin, y, {
    size: 10,
    color: gray,
    align: 'right'
  });
  y -= 14;
  drawText('Tax (6%):', col2X, y, {
    size: 10,
    color: gray
  });
  drawText(formatCurrency(tax), width - margin, y, {
    size: 10,
    color: gray,
    align: 'right'
  });
  y -= 18;
  drawDivider(page, y, col2X, width, lightGray);
  y -= 14;
  drawText('TOTAL PAID:', col2X, y, {
    font: fontBold,
    size: 12,
    color: navy
  });
  drawText(formatCurrency(booking.total_price || 0), width - margin, y, {
    font: fontBold,
    size: 12,
    color: navy,
    align: 'right'
  });
  // ── Footer ────────────────────────────────────────────────────────────
  y -= 40;
  drawDivider(page, y, margin, width, lightGray);
  y -= 16;
  drawText('Thank you for choosing U-Fill Dumpsters!', width / 2, y, {
    font: fontBold,
    size: 10,
    color: navy,
    align: 'left'
  });
  // center it manually
  const thankWidth = fontBold.widthOfTextAtSize('Thank you for choosing U-Fill Dumpsters!', 10);
  page.drawText('Thank you for choosing U-Fill Dumpsters!', {
    x: (width - thankWidth) / 2,
    y,
    size: 10,
    font: fontBold,
    color: navy
  });
  y -= 14;
  const noteText = 'Questions? Call (801) 810-8832 or visit u-filldumpsters.com';
  const noteWidth = fontRegular.widthOfTextAtSize(noteText, 9);
  page.drawText(noteText, {
    x: (width - noteWidth) / 2,
    y,
    size: 9,
    font: fontRegular,
    color: gray
  });
  return await pdfDoc.save();
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error('Booking ID is required.');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(*), plan:plan, addons:addons').eq('id', bookingId).single();
    if (bookingError || !booking) throw new Error(bookingError?.message || 'Booking not found.');
    const { data: serviceData, error: serviceError } = await supabaseAdmin.from('services').select('*').eq('id', booking.plan.id).single();
    if (serviceError || !serviceData) throw new Error(serviceError?.message || 'Service not found.');
    booking.plan.name = serviceData.name;
    const pdfBytes = await generatePDFReceipt(booking);
    // Safe Base64 encoding that handles large files without stack overflow
    let binary = '';
    const chunkSize = 8192;
    for(let i = 0; i < pdfBytes.length; i += chunkSize){
      binary += String.fromCharCode(...pdfBytes.slice(i, i + chunkSize));
    }
    const pdfBase64 = btoa(binary);
    return new Response(JSON.stringify({
      pdf: pdfBase64
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get Receipt PDF Error:', error);
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
