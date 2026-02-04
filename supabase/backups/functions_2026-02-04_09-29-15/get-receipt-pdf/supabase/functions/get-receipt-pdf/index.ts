import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { format } from 'https://deno.land/std@0.208.0/datetime/mod.ts';
const generateHTMLReceipt = (booking)=>{
  const formatDate = (dateStr)=>dateStr ? format(new Date(dateStr), 'MM/dd/yyyy') : 'N/A';
  const formatCurrency = (amount)=>amount != null ? `$${Number(amount).toFixed(2)}` : '$0.00';
  const serviceName = booking.plan?.name + (booking.addons?.isDelivery ? ' with Delivery' : '');
  const dropOffDate = formatDate(booking.drop_off_date);
  const pickupDate = formatDate(booking.pickup_date);
  let subtotal = booking.plan?.price || 0;
  const fees = [];
  if (booking.addons?.deliveryFee) {
    subtotal += booking.addons.deliveryFee;
    fees.push({
      name: 'Delivery Fee',
      amount: booking.addons.deliveryFee
    });
  }
  if (booking.addons?.fuelSurcharge) {
    subtotal += booking.addons.fuelSurcharge;
    fees.push({
      name: 'Fuel Surcharge',
      amount: booking.addons.fuelSurcharge
    });
  }
  if (booking.addons?.protectionPlan) {
    subtotal += booking.addons.protectionPlan;
    fees.push({
      name: 'Damage Protection',
      amount: booking.addons.protectionPlan
    });
  }
  // Assuming 6% tax. It's better to calculate this based on the final price if possible.
  const tax = booking.total_price / 1.06 * 0.06;
  const basePrice = booking.total_price - tax;
  const subtotalWithoutCoupon = basePrice - fees.reduce((acc, fee)=>acc + fee.amount, 0);
  const coupon = booking.addons?.coupon;
  let discountLine = '';
  if (coupon && coupon.isValid) {
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'percentage') {
      // This is a rough calculation, depends on what the percentage is applied to
      discountAmount = booking.plan.price * (coupon.discountValue / 100);
    }
    discountLine = `
          <tr class="item">
            <td>Coupon (${coupon.code})</td>
            <td class="text-right">-${formatCurrency(discountAmount)}</td>
          </tr>
        `;
  }
  return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Receipt #${booking.id}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #333; }
            .invoice-box { max-width: 800px; margin: auto; padding: 30px; border: 1px solid #eee; box-shadow: 0 0 10px rgba(0, 0, 0, .15); font-size: 16px; line-height: 24px; }
            .invoice-box table { width: 100%; line-height: inherit; text-align: left; border-collapse: collapse; }
            .invoice-box table td { padding: 5px; vertical-align: top; }
            .invoice-box table tr td:nth-child(2) { text-align: right; }
            .invoice-box table tr.top table td { padding-bottom: 20px; }
            .invoice-box table tr.top table td.title { font-size: 45px; line-height: 45px; color: #333; }
            .invoice-box table tr.information table td { padding-bottom: 40px; }
            .invoice-box table tr.heading td { background: #eee; border-bottom: 1px solid #ddd; font-weight: bold; }
            .invoice-box table tr.details td { padding-bottom: 20px; }
            .invoice-box table tr.item td { border-bottom: 1px solid #eee; }
            .invoice-box table tr.item.last td { border-bottom: none; }
            .invoice-box table tr.total td:nth-child(2) { border-top: 2px solid #eee; font-weight: bold; }
            .text-right { text-align: right; }
          </style>
        </head>
        <body>
          <div class="invoice-box">
            <table>
              <tr class="top">
                <td colspan="2">
                  <table>
                    <tr>
                      <td class="title">U-Fill Dumpsters</td>
                      <td>
                        Receipt #: ${booking.id}<br>
                        Created: ${formatDate(booking.created_at)}<br>
                        Booking Status: ${booking.status}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr class="information">
                <td colspan="2">
                  <table>
                    <tr>
                      <td>
                        U-Fill Dumpsters LLC<br>
                        Saratoga Springs, UT<br>
                        (801) 810-8832
                      </td>
                      <td>
                        <strong>Billed To:</strong><br>
                        ${booking.customers.name}<br>
                        ${booking.customers.email}<br>
                        ${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr class="heading">
                <td>Service Details</td>
                <td class="text-right">Price</td>
              </tr>
              <tr class="item">
                <td>
                  <strong>${serviceName}</strong><br>
                  <small>Drop-off: ${dropOffDate} (${booking.drop_off_time_slot || 'N/A'})</small><br>
                  <small>Pick-up: ${pickupDate} (${booking.pickup_time_slot || 'N/A'})</small>
                </td>
                <td class="text-right">${formatCurrency(booking.plan?.price)}</td>
              </tr>
              ${fees.map((fee)=>`
                <tr class="item">
                  <td>${fee.name}</td>
                  <td class="text-right">${formatCurrency(fee.amount)}</td>
                </tr>
              `).join('')}
              ${discountLine}
              <tr class="total">
                <td></td>
                <td class="text-right">Subtotal: ${formatCurrency(basePrice)}</td>
              </tr>
              <tr class="total">
                <td></td>
                <td class="text-right">Tax (6%): ${formatCurrency(tax)}</td>
              </tr>
              <tr class="total">
                <td></td>
                <td class="text-right"><strong>Total Paid: ${formatCurrency(booking.total_price)}</strong></td>
              </tr>
            </table>
          </div>
        </body>
        </html>
      `;
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      throw new Error('Booking ID is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(*), plan:plan, addons:addons').eq('id', bookingId).single();
    if (bookingError || !booking) {
      throw new Error(bookingError?.message || 'Booking not found.');
    }
    const { data: serviceData, error: serviceError } = await supabaseAdmin.from('services').select('*').eq('id', booking.plan.id).single();
    if (serviceError || !serviceData) {
      throw new Error(serviceError?.message || 'Service details not found for receipt.');
    }
    booking.plan.name = serviceData.name;
    const htmlContent = generateHTMLReceipt(booking);
    // This is a simulation of PDF generation. We encode the HTML to base64.
    const pdfBytes = new TextEncoder().encode(htmlContent);
    const pdfBase64 = btoa(String.fromCharCode.apply(null, pdfBytes));
    return new Response(JSON.stringify({
      pdf: pdfBase64
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Get Receipt PDF Error:", error);
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
