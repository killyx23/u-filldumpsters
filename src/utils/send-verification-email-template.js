export const generateVerificationEmailTemplate = (code, verifyLink) => {
  const currentYear = new Date().getFullYear();
  
  return `
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
          background-color: #1e3a8a; /* Deep professional blue */
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
          <!-- Placeholder for actual company logo -->
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
          <p><a href="https://ufilldumpsters.com/contact">Contact Support</a> | <a href="https://ufilldumpsters.com/faq">FAQ</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
};