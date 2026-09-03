/**
 * Shared Brevo / Resend email + Brevo / Twilio SMS helpers.
 * SMS_PROVIDER env: "brevo" (default) | "twilio"
 */

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const BREVO_SMS_SENDER = Deno.env.get("BREVO_SMS_SENDER") || "UFillDump";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SMS_PROVIDER = (Deno.env.get("SMS_PROVIDER") || "brevo").toLowerCase();
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

export type SendEmailResult = {
  success: boolean;
  provider?: string;
  error?: string;
  result?: unknown;
  /** Provider message id when available (Brevo messageId / Resend id). */
  messageId?: string;
};

export type SendSmsResult = {
  success: boolean;
  provider?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
  result?: unknown;
};

/** Normalize to E.164-ish digits; assume US (+1) when 10 digits. */
export function normalizePhoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function sendEmail(
  toEmail: string,
  subject: string,
  htmlContent: string,
  maxRetries = 4,
): Promise<SendEmailResult> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ts = new Date().toISOString();
    try {
      if (BREVO_API_KEY) {
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { email: BREVO_FROM_EMAIL, name: "U-Fill Dumpsters" },
            to: [{ email: toEmail }],
            subject,
            htmlContent,
          }),
        });
        if (brevoResponse.ok) {
          const result = await brevoResponse.json();
          const messageId =
            typeof result?.messageId === "string"
              ? result.messageId
              : typeof result?.messageIds?.[0] === "string"
              ? result.messageIds[0]
              : undefined;
          console.log(
            `[${ts}] [notify] Brevo accepted email to=${toEmail} from=${BREVO_FROM_EMAIL} messageId=${messageId || "unknown"}`,
          );
          return { success: true, provider: "brevo", result, messageId };
        }
        lastError = `Brevo API error: ${await brevoResponse.text()}`;
        console.error(`[${ts}] [notify] Brevo email failed:`, lastError);
      }

      if (RESEND_API_KEY) {
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [toEmail],
            subject,
            html: htmlContent,
          }),
        });
        if (resendResponse.ok) {
          const result = await resendResponse.json();
          const messageId = typeof result?.id === "string" ? result.id : undefined;
          console.log(
            `[${ts}] [notify] Resend accepted email to=${toEmail} messageId=${messageId || "unknown"}`,
          );
          return { success: true, provider: "resend", result, messageId };
        }
        lastError = `Resend API error: ${await resendResponse.text()}`;
        console.error(`[${ts}] [notify] Resend email failed:`, lastError);
      }

      if (!BREVO_API_KEY && !RESEND_API_KEY) {
        return { success: false, error: "No email service configured" };
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[${ts}] [notify] Email exception:`, lastError);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  return { success: false, error: lastError || "Unknown email error" };
}

async function sendSmsBrevo(toE164: string, content: string): Promise<SendSmsResult> {
  if (!BREVO_API_KEY) {
    return { success: false, error: "BREVO_API_KEY not configured" };
  }
  const res = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: BREVO_SMS_SENDER.slice(0, 11),
      recipient: toE164,
      content,
      type: "transactional",
    }),
  });
  if (!res.ok) {
    return { success: false, provider: "brevo", error: await res.text() };
  }
  return { success: true, provider: "brevo", result: await res.json() };
}

async function sendSmsTwilio(toE164: string, content: string): Promise<SendSmsResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { success: false, error: "Twilio env vars not configured" };
  }
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({
    To: toE164,
    From: TWILIO_FROM_NUMBER,
    Body: content,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  if (!res.ok) {
    return { success: false, provider: "twilio", error: await res.text() };
  }
  return { success: true, provider: "twilio", result: await res.json() };
}

/**
 * Send an SMS. Skips when phone is missing or customer has opted out.
 * @param smsOptIn - when false, skip; when undefined/true, send
 */
export async function sendSms(
  phone: string | null | undefined,
  content: string,
  options: { smsOptIn?: boolean | null } = {},
): Promise<SendSmsResult> {
  if (options.smsOptIn === false) {
    return { success: true, skipped: true, reason: "sms_opt_out" };
  }
  const toE164 = normalizePhoneE164(phone);
  if (!toE164) {
    return { success: true, skipped: true, reason: "invalid_phone" };
  }

  try {
    if (SMS_PROVIDER === "twilio") {
      return await sendSmsTwilio(toE164, content);
    }
    return await sendSmsBrevo(toE164, content);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
