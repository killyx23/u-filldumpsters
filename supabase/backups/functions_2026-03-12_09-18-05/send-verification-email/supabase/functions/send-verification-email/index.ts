import { corsHeaders } from "./cors.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL') || 'noreply@ufilldumpsters.com';
const SITE_URL = Deno.env.get('SITE_URL') || 'http://localhost:3000';
function generateEmailTemplate(code, verifyLink) {
  const currentYear = new Date().getFullYear();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email Address</title>
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .header { background-color: #1e3a8a; padding: 35px 20px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; }
        .header p { color: #bfdbfe; margin: 10px 0 0; font-size: 16px; }
        .content { padding: 40px 30px; color: #374151; line-height: 1.6; }
        .content h2 { color: #111827; font-size: 22px; margin-top: 0; margin-bottom: 20px; }
        .code-container { background-color: #f8fafc; border: 2px dashed #94a3b8; border-radius: 8px; padding: 25px; text-align: center; margin: 35px 0; }
        .code-container .code { font-size: 42px; font-weight: 800; color: #1e3a8a; letter-spacing: 6px; margin: 0; }
        .code-container .label { font-size: 14px; color: #64748b; text-transform: uppercase; margin-bottom: 10px; }
        .btn-container { text-align: center; margin: 35px 0; }
        .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 16px 36px; border-radius: 8px; font-size: 18px; font-weight: 600; }
        .notice { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 4px; font-size: 14px; color: #92400e; margin-top: 30px; }
        .footer { background-color: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0; }
        .footer p { color: #64748b; font-size: 13px; margin: 5px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>U-Fill Dumpsters</h1>
          <p>Reliable Waste Solutions</p>
        </div>
        <div class="content">
          <h2>Verify Your Email Address</h2>
          <p>Hello,</p>
          <p>Thank you for connecting with U-Fill Dumpsters. To securely access your customer portal, please verify your email address using the code or button below.</p>
          
          <div class="code-container">
            <div class="label">Your Verification Code</div>
            <div class="code">${code}</div>
          </div>
          
          <p style="text-align: center; font-weight: 600; color: #475569;">Or verify instantly by clicking the button below:</p>
          
          <div class="btn-container">
            <a href="${verifyLink}" class="btn">Verify Email Address</a>
          </div>
          
          <div class="notice">
            <strong>Note:</strong> This verification code and link will expire in exactly 24 hours for your security.
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${currentYear} U-Fill Dumpsters LLC. All rights reserved.</p>
          <p>If you did not request this verification, you can safely ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      throw new Error("Email is required");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Generate 6-digit numeric code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // 24 hour expiration
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // Store in our custom table
    const { error: dbError } = await supabase.from('email_verifications').upsert({
      email,
      verification_code: code,
      code_expires_at: expiresAt,
      is_verified: false,
      attempts: 0
    });
    if (dbError) {
      console.error("[send-verification-email] DB Error:", dbError);
      throw new Error("Failed to store verification code");
    }
    // Prepare Brevo Email
    if (!BREVO_API_KEY) {
      console.warn("[send-verification-email] WARNING: BREVO_API_KEY missing. Code stored but email not sent.");
      return new Response(JSON.stringify({
        success: true,
        message: "Development mode: Code generated.",
        _debugCode: code
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Generate exact URL as requested
    const verifyLink = `${SITE_URL}/verify?code=${code}`;
    const htmlBody = generateEmailTemplate(code, verifyLink);
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          email: BREVO_FROM_EMAIL,
          name: 'U-Fill Dumpsters'
        },
        to: [
          {
            email
          }
        ],
        subject: 'Verify Your Email Address - U-Fill Dumpsters',
        htmlContent: htmlBody
      })
    });
    if (!brevoResponse.ok) {
      const errText = await brevoResponse.text();
      console.error("[send-verification-email] Brevo Error:", errText);
      throw new Error("Failed to send email via Bravo provider.");
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Verification email sent successfully"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[send-verification-email] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 400
    });
  }
});
