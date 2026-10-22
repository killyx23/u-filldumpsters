import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendTransactionalSms } from "../_shared/brevo-sms.ts";
import {
  assertAllowedDestination,
  generateVerificationCode,
  hashVerificationCode,
  jsonResponse,
  markSmsFailed,
  markSmsSent,
  openSmsPost,
  readJsonObject,
  readSmsConfig,
  rejectUnknownKeys,
  requireSmsUser,
  reserveSmsSend,
  SmsHttpError,
  smsErrorResponse,
} from "../_shared/sms-guard.ts";

Deno.serve(async (req) => {
  const opened = openSmsPost(req);
  if (opened.response) return opened.response;
  const { cors } = opened;

  let logId: string | null = null;
  let codeId: string | null = null;
  let admin: SupabaseClient | null = null;

  try {
    const config = readSmsConfig();
    const caller = await requireSmsUser(req);
    admin = caller.admin;
    const body = await readJsonObject(req);
    rejectUnknownKeys(body, ["phone"]);
    if (typeof body.phone !== "string") {
      throw new SmsHttpError(400, "Invalid request", "phone type");
    }

    const recipient = assertAllowedDestination(body.phone, config.allowedCountryCodes);
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(config.hmacSecret, caller.userId, recipient, code);
    const reserved = await reserveSmsSend({
      admin: caller.admin,
      userId: caller.userId,
      type: "verification",
      template: null,
      phoneDigits: recipient,
      userHourLimit: 3,
      userDayLimit: 5,
      phoneHourLimit: 3,
      globalDailyCap: config.dailyGlobalCap,
      codeHash,
    });
    logId = reserved.logId;
    codeId = reserved.codeId;

    const sent = await sendTransactionalSms({
      apiKey: config.apiKey,
      sender: config.sender,
      to: recipient,
      content: `U-Fill Dumpsters verification code: ${code}. It expires in 10 minutes.`,
      tag: "phoneVerification",
    });
    await markSmsSent(caller.admin, reserved.logId, sent.messageId);
    logId = null;
    codeId = null;
    console.info(`[send-verification-code] sent last4=${recipient.slice(-4)}`);
    return jsonResponse(cors, 200, { sent: true });
  } catch (error) {
    if (logId && admin) await markSmsFailed(admin, logId, codeId);
    return smsErrorResponse(cors, error, "Unable to send SMS");
  }
});
