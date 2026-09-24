/**
 * Shared HTML for the "Sorry to see you go" early-leave / unfinished-checkout email.
 */

export function buildEarlyLeaveEmailHtml(opts: {
  firstName: string;
  feedbackUrl: string;
  contactUrl: string;
  unsubscribeUrl: string;
}): string {
  const { firstName, feedbackUrl, contactUrl, unsubscribeUrl } = opts;
  const homeUrl = feedbackUrl.split("?")[0].replace(/\/how-can-we-do-better$/, "/");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.3;">Sorry to see you go</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">
          We noticed you left before finishing your booking. No hard feelings — we hope to see you again soon whenever you are ready.
        </p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">
          We are always trying to do better. If there is something we could offer, change, or clarify to help you get your job done, we would love to hear it.
        </p>
        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${feedbackUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            Tell us how we can do better
          </a>
        </div>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#475569;text-align:center;">
          Prefer a phone call back? Visit our
          <a href="${contactUrl}" style="color:#1e3a8a;font-weight:700;text-decoration:none;">Contact page</a>
          and we will help answer your questions on a timeline that works for you.
        </p>
      </div>
      <div style="padding:18px 24px;background:#0f172a;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
          You fill it, we dump it — convenience brought to you.<br/>
          <a href="${homeUrl}" style="color:#fbbf24;text-decoration:none;">u-filldumpsters.com</a>
        </p>
        <p style="margin:14px 0 0;color:#64748b;font-size:9px;line-height:1.4;">
          If you no longer want to receive any future correspondence click here to
          <a href="${unsubscribeUrl}" style="color:#fbbf24;font-weight:700;text-decoration:underline;">unsubscribe</a>.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export const EARLY_LEAVE_EMAIL_SUBJECT = "Sorry to see you go — how can we do better?";
