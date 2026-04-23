// send-confirmation/index.ts
// Update: remove the secondary receipt link; keep a single portal link or a single direct receipt link (if provided)
import { createClient } from 'npm:@supabase/supabase-js@2.45.1';
const BREVO_API_KEY = (Deno.env.get('BREVO_API_KEY') ?? '').trim();
const FROM_EMAIL = (Deno.env.get('BREVO_FROM_EMAIL') ?? '').trim();
// Optional URLs
const PORTAL_URL = (Deno.env.get('PORTAL_URL') ?? 'https://www.u-filldumpsters.com/login').trim();
const RECEIPT_URL = (Deno.env.get('RECEIPT_URL') ?? 'https://www.u-filldumpsters.com/receipt').trim();
const MAX_ATTACHMENT_BASE64_BYTES = 8 * 1024 * 1024; // 8MB
Deno.serve(async (req)=>{
  try {
    if (req.method === 'OPTIONS') return new Response('ok', {
      headers: corsHeaders()
    });
    if (req.method !== 'POST') {
      return json({
        error: 'Method not allowed'
      }, 405);
    }
    if (!BREVO_API_KEY || !FROM_EMAIL) {
      return json({
        error: 'Missing BREVO_API_KEY or BREVO_FROM_EMAIL'
      }, 500);
    }
    // Strictly parse JSON body
    let body = null;
    try {
      body = await req.json();
    } catch  {
      return json({
        error: 'Invalid JSON. Expecting { "bookingId": <id> }'
      }, 400);
    }
    const bookingId = body?.bookingId;
    if (!bookingId || ![
      'string',
      'number'
    ].includes(typeof bookingId)) {
      return json({
        error: 'Booking ID is required.'
      }, 400);
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({
        error: 'Server misconfiguration (missing SUPABASE_URL or SERVICE_ROLE_KEY).'
      }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Load booking + related customer; adjust select/path to your schema
    const { data: booking, error: bookingError } = await admin.from('bookings').select(`
        id,
        status,
        customers:customers (
          email,
          name,
          customer_id_text,
          phone
        )
      `).eq('id', bookingId).single();
    if (bookingError || !booking) {
      return json({
        error: `Booking not found for id ${bookingId}`,
        detail: bookingError?.message ?? null
      }, 404);
    }
    const customer = booking.customers;
    if (!customer) return json({
      error: 'Booking has no related customer.'
    }, 422);
    const email = String(customer.email ?? '').trim();
    const name = String(customer.name ?? '').trim() || 'Customer';
    const customerIdText = String(customer.customer_id_text ?? '').trim();
    const phone = String(customer.phone ?? '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({
        error: `Invalid or missing customer email: "${email}"`
      }, 422);
    }
    // Build links (single link preference)
    const portalLink = `${PORTAL_URL}?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(phone)}`;
    const receiptLink = RECEIPT_URL ? `${RECEIPT_URL}?bookingId=${encodeURIComponent(String(booking.id))}` : '';
    // Try to generate PDF; only attach if valid
    const { pdfBase64, pdfDiagnostics } = await tryGeneratePdf(admin, bookingId);
    // Email content
    const isPending = booking.status === 'pending_review' || booking.status === 'pending_verification';
    const subject = isPending ? `Action Required: Your Booking #${booking.id} is On Hold` : `Booking Confirmed: U-Fill Dumpsters Service #${booking.id}`;
    const confirmedBase = 'Thank you for your booking with U-Fill Dumpsters! Your service is confirmed.';
    const attachmentLine = pdfBase64 ? ' A detailed receipt is attached.' : '';
    // Single-link rule: prefer direct receipt if available; otherwise portal
    const primaryLink = receiptLink || portalLink;
    const primaryLabel = receiptLink ? 'Download your receipt' : 'Open your Customer Portal';
    const linkLine = primaryLink ? ` You can ${receiptLink ? 'also ' : ''} ${receiptLink ? '' : ''}access it here: ${primaryLink}` : '';
    const message = isPending ? 'Thank you for your rental request. Your booking is currently on hold and requires manual review. We will process it shortly.' : `${confirmedBase}${attachmentLine}${linkLine}`;
    // Single callout block with only one actionable link
    const infoBlock = singleActionBlock(primaryLink, primaryLabel, customerIdText, phone, isPending);
    const htmlContent = generateEmailHtml(name, subject, message, infoBlock);
    // Build Brevo payload; only include attachments when we have a valid base64
    const emailPayload = {
      sender: {
        email: FROM_EMAIL,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email,
          name
        }
      ],
      subject,
      htmlContent
    };
    if (pdfBase64) emailPayload.attachments = [
      {
        name: `U-Fill-Receipt-${booking.id}.pdf`,
        content: pdfBase64
      }
    ];
    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });
    const emailText = await safeReadText(emailRes);
    if (!emailRes.ok) {
      return json({
        error: `Brevo API Error: ${emailRes.status} ${emailRes.statusText}`,
        brevo: tryParseJson(emailText) ?? emailText ?? null,
        pdfAttached: Boolean(pdfBase64),
        pdfDiagnostics,
        primaryLink
      }, 502);
    }
    return json({
      message: 'Confirmation email accepted by Brevo.',
      pdfAttached: Boolean(pdfBase64),
      pdfDiagnostics,
      primaryLink
    }, 200);
  } catch (e) {
    console.error('Send Confirmation Email Error:', e);
    return json({
      error: e?.message ?? 'Unexpected error'
    }, 500);
  }
});
// Helpers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json'
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders()
  });
}
async function tryGeneratePdf(admin, bookingId) {
  const pdfDiagnostics = [];
  let pdfBase64 = null;
  try {
    const { data, error } = await admin.functions.invoke('generate-receipt-pdf', {
      body: {
        booking: {
          id: bookingId
        }
      }
    });
    if (error) {
      pdfDiagnostics.push(`generate-receipt-pdf error: ${error.message}`);
    } else {
      // If function returns application/pdf stream in other flows, this path may be JSON-only.
      // Here we expect JSON with { pdf: base64 } for attachment use-cases only.
      const candidate = data?.pdf;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        const stripped = candidate.trim();
        if (!isLikelyBase64(stripped)) {
          pdfDiagnostics.push('PDF not valid base64; skipping attachment.');
        } else {
          const approxBytes = Math.floor(stripped.length * 3 / 4);
          if (approxBytes > MAX_ATTACHMENT_BASE64_BYTES) {
            pdfDiagnostics.push(`PDF too large (~${(approxBytes / (1024 * 1024)).toFixed(2)}MB); skipping attachment.`);
          } else {
            pdfBase64 = stripped;
          }
        }
      } else {
        pdfDiagnostics.push('No base64 PDF payload received; email will include single action link only.');
      }
    }
  } catch (e) {
    pdfDiagnostics.push(`invoke error: ${e?.message ?? 'unknown'}`);
  }
  return {
    pdfBase64,
    pdfDiagnostics
  };
}
function singleActionBlock(link, label, cid, phone, isPending) {
  const creds = isPending ? `<br><br><strong>Pre-filled login details:</strong><br>Customer ID: <strong>${escapeHtml(cid)}</strong><br>Phone: <strong>${escapeHtml(phone)}</strong>` : '';
  return `
    <div style="background-color:#eef7ff;border:1px solid #b3d7ff;padding:15px;border-radius:5px;margin-top:20px;">
      <a href="${linkSafe(link)}" style="display:inline-block;background:#0b5cab;color:#fff;padding:10px 14px;border-radius:4px;text-decoration:none;">${escapeHtml(label)}</a>
      ${creds}
    </div>
  `;
}
function generateEmailHtml(name, subject, message, actionBlock) {
  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:#333; line-height:1.6; }
      .container { max-width:600px; margin:20px auto; padding:20px; border:1px solid #ddd; border-radius:8px; background:#f9f9f9; }
      .header { font-size:22px; font-weight:bold; color:#003366; text-align:center; margin-bottom:18px; }
      .footer { font-size:12px; color:#777; margin-top:20px; text-align:center; }
      a { color:#0b5cab; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">${escapeHtml(subject)}</div>
      <p>Hello ${escapeHtml(name)},</p>
      <p>${escapeHtml(message)}</p>
      ${actionBlock}
      <p>We look forward to serving you!</p>
      <p>Sincerely,<br>U-Fill Dumpsters Team</p>
      <div class="footer">U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832</div>
    </div>
  </body>
  </html>`;
}
function isLikelyBase64(s) {
  return /^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.replace(/\r|\n/g, '').length % 4 === 0;
}
async function safeReadText(res) {
  try {
    return await res.text();
  } catch  {
    return '';
  }
}
function tryParseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch  {
    return null;
  }
}
function linkSafe(url) {
  return String(url).replaceAll('"', '%22').replaceAll('<', '%3C').replaceAll('>', '%3E');
}
function escapeHtml(input) {
  return String(input).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
