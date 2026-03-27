import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      throw new Error('Email is required');
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Database configuration missing');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Generate a secure 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Code valid for 24 hours
    // Store the verification code in the database
    const { error: dbError } = await supabase.from('email_verifications').upsert({
      email: email,
      verification_code: verificationCode,
      code_expires_at: expiresAt.toISOString(),
      is_verified: false,
      attempts: 0
    }, {
      onConflict: 'email'
    });
    if (dbError) {
      console.error('Database error storing code:', dbError);
      throw new Error('Failed to generate verification request');
    }
    // Determine the base URL for the verification link
    // Default to the provided SITE_URL or fallback to origin
    let siteUrl = Deno.env.get('SITE_URL') || req.headers.get('origin') || 'https://ufilldumpsters.com';
    // Remove trailing slash if present to avoid double slashes
    siteUrl = siteUrl.replace(/\/$/, '');
    // CRITICAL FIX: Ensure the link is formatted perfectly as a query parameter
    const verifyLink = `${siteUrl}/verify-email?code=${verificationCode}`;
    const currentYear = new Date().getFullYear();
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email Address</title>
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
            transition: background-color 0.2s;
          }
          .btn:hover {
            background-color: #1d4ed8;
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
            <p>Hello,</p>
            <p>Thank you for connecting with U-Fill Dumpsters. To securely access your customer portal, please verify your email address using the code or button below.</p>
            
            <div class="code-container">
              <div class="label">Your Verification Code</div>
              <div class="code">${verificationCode}</div>
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
            <p><a href="${siteUrl}/contact">Contact Support</a> | <a href="${siteUrl}/faq">FAQ</a></p>
          </div>
        </div>
      </body>
      </html>
    `;
    // Try sending via Brevo first (primary service for this app)
    const brevoApiKey = Deno.env.get('BREVO_API_KEY');
    const brevoFromEmail = Deno.env.get('BREVO_FROM_EMAIL') || 'noreply@ufilldumpsters.com';
    if (brevoApiKey) {
      const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            email: brevoFromEmail,
            name: 'U-Fill Dumpsters'
          },
          to: [
            {
              email: email
            }
          ],
          subject: 'Verify Your Email Address - U-Fill Dumpsters',
          htmlContent: htmlContent
        })
      });
      if (!emailResponse.ok) {
        const errText = await emailResponse.text();
        console.error("Brevo Email Send Error:", errText);
        throw new Error('Failed to send verification email via Brevo');
      }
    } else {
      // Fallback to Resend if Brevo isn't configured
      const resendApiKey = Deno.env.get('RESEND_API_KEY');
      if (!resendApiKey) {
        throw new Error('No email provider API keys configured (Brevo or Resend)');
      }
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'U-Fill Dumpsters <noreply@ufilldumpsters.com>',
          to: [
            email
          ],
          subject: 'Verify Your Email Address - U-Fill Dumpsters',
          html: htmlContent
        })
      });
      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        console.error("Resend Email Send Error:", errText);
        throw new Error('Failed to send verification email via Resend');
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: 'Verification email sent successfully.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Send verification email error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'An unexpected error occurred'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
