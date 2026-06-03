import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const DEFAULT_SITE_URL = "https://u-filldumpsters.com";

function normalizeSiteUrl(url?: string | null) {
  const fallback = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
  const candidate = url && url.trim().length > 0 ? url : fallback;

  try {
    const parsed = new URL(candidate);
    return `${parsed.origin}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, name, pending_customer_id, token, site_url } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({
        error: "Email is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!BREVO_API_KEY || BREVO_API_KEY.trim().length === 0) {
      console.error("[send-verification-email] Missing BREVO_API_KEY");
      return new Response(JSON.stringify({
        error: "Email service is not configured. Please contact support."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!BREVO_FROM_EMAIL || BREVO_FROM_EMAIL.trim().length === 0) {
      console.error("[send-verification-email] Missing BREVO_FROM_EMAIL");
      return new Response(JSON.stringify({
        error: "Sender email is not configured. Please contact support."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    console.log("[send-verification-email] Generating code for:", email);
    // Store verification code in database
    const { error: dbError } = await supabase.from("email_verifications").upsert({
      email: email.toLowerCase(),
      verification_code: verificationCode,
      code_expires_at: expiresAt.toISOString(),
      is_verified: false,
      attempts: 0,
      created_at: new Date().toISOString()
    }, {
      onConflict: "email"
    });
    if (dbError) {
      console.error("[send-verification-email] Database error:", dbError);
      throw new Error("Failed to store verification code");
    }
    const siteUrl = normalizeSiteUrl(site_url);
    const pendingToken = String(pending_customer_id ?? token ?? "").trim();
    const verifyPath = pendingToken
      ? `/verify-email?token=${encodeURIComponent(pendingToken)}&code=${encodeURIComponent(verificationCode)}`
      : `/customer-login?code=${encodeURIComponent(verificationCode)}`;
    const verifyLink = `${siteUrl}${verifyPath}`;
    console.log("[send-verification-email] Verification link:", verifyLink);
    // Send email via Brevo
    const emailHtml = generateEmailTemplate(verificationCode, verifyLink, name || "Customer", siteUrl);
    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: "U-Fill Dumpsters",
          email: BREVO_FROM_EMAIL
        },
        to: [
          {
            email,
            name: name || "Customer"
          }
        ],
        subject: "Verify Your Email - U-Fill Dumpsters",
        htmlContent: emailHtml
      })
    });
    if (!brevoResponse.ok) {
      const errorText = await brevoResponse.text();
      console.error("[send-verification-email] Brevo error:", errorText);
      throw new Error("Failed to send verification email");
    }
    console.log("[send-verification-email] ✓ Email sent successfully to:", email);
    return new Response(JSON.stringify({
      success: true,
      message: "Verification email sent successfully",
      expiresAt: expiresAt.toISOString()
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[send-verification-email] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Failed to send verification email"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
function generateEmailTemplate(code, verifyLink, name, siteUrl = DEFAULT_SITE_URL) {
  const currentYear = new Date().getFullYear();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email Address</title>
      <!--[if mso]>
      <style type="text/css">
        body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
      </style>
      <![endif]-->
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          background-color: #f3f4f6;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .header {
          background-color: #1e3a8a;
          padding: 35px 20px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .header p {
          color: #bfdbfe;
          margin: 10px 0 0;
          font-size: 16px;
        }
        .content {
          padding: 40px 30px;
          color: #374151;
          line-height: 1.6;
        }
        .content h2 {
          color: #111827;
          font-size: 22px;
          margin-top: 0;
          margin-bottom: 20px;
        }
        .content p {
          font-size: 16px;
          margin-bottom: 20px;
        }
        .code-container {
          background-color: #f8fafc;
          border: 2px dashed #94a3b8;
          border-radius: 8px;
          padding: 25px;
          text-align: center;
          margin: 35px 0;
        }
        .code-container .code {
          font-size: 42px;
          font-weight: 800;
          color: #1e3a8a;
          letter-spacing: 6px;
          margin: 0;
        }
        .code-container .label {
          font-size: 14px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }
        .btn-container {
          text-align: center;
          margin: 35px 0;
        }
        .btn {
          display: inline-block;
          background-color: #2563eb;
          color: #ffffff !important;
          text-decoration: none;
          padding: 16px 36px;
          border-radius: 8px;
          font-size: 18px;
          font-weight: 600;
          box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);
        }
        .notice {
          background-color: #fffbeb;
          border-left: 4px solid #f59e0b;
          padding: 15px;
          border-radius: 4px;
          font-size: 14px;
          color: #92400e;
          margin-top: 30px;
        }
        .footer {
          background-color: #f8fafc;
          padding: 25px 30px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
        }
        .footer p {
          color: #64748b;
          font-size: 13px;
          margin: 5px 0;
        }
        .footer a {
          color: #3b82f6;
          text-decoration: none;
        }
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
          <p>Hello ${name},</p>
          <p>Thank you for booking with U-Fill Dumpsters. To complete your booking and receive your access PIN, please verify your email address using the code or button below.</p>
          
          <div class="code-container">
            <div class="label">Your Verification Code</div>
            <div class="code">${code}</div>
          </div>
          
          <p style="text-align: center; font-weight: 600; color: #475569;">Or verify instantly by clicking the button below:</p>
          
          <div class="btn-container">
            <a href="${verifyLink}" class="btn">Verify Email Address</a>
          </div>
          
          <div class="notice">
            <strong>Note:</strong> This verification code and link will expire in 24 hours for your security.
          </div>
        </div>
        
        <div class="footer">
          <p>&copy; ${currentYear} U-Fill Dumpsters LLC. All rights reserved.</p>
          <p>If you did not request this verification, you can safely ignore this email.</p>
          <p><a href="${siteUrl}/contact">Contact Support</a> | <a href="${siteUrl}/faqs">FAQ</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
}
