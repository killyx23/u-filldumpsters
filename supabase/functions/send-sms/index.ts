import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendTransactionalSms } from "../_shared/brevo-sms.ts";
import {
  assertAllowedDestination,
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

type StringParam = {
  kind: "string";
  maxLength: number;
  pattern: RegExp;
};

type EnumParam = {
  kind: "enum";
  values: readonly string[];
};

type TemplateParam = StringParam | EnumParam;

type SmsTemplate = {
  params: Record<string, TemplateParam>;
  render: (params: Record<string, string>) => string;
};

const TEMPLATES: Record<string, SmsTemplate> = {
  appointment_reminder: {
    params: {
      when: { kind: "string", maxLength: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9 :,./-]{0,39}$/ },
      place: { kind: "string", maxLength: 60, pattern: /^[A-Za-z0-9][A-Za-z0-9 #,./-]{0,59}$/ },
    },
    render: (params) => `U-Fill Dumpsters: appointment ${params.when} at ${params.place}.`,
  },
  order_update: {
    params: {
      orderNumber: { kind: "string", maxLength: 12, pattern: /^[0-9]{1,12}$/ },
      status: { kind: "enum", values: ["scheduled", "ready", "completed"] },
    },
    render: (params) => `U-Fill Dumpsters: order ${params.orderNumber} is now ${params.status}.`,
  },
};

function validateParams(template: SmsTemplate, value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SmsHttpError(400, "Invalid request", "params shape");
  }
  const record = value as Record<string, unknown>;
  const expected = Object.keys(template.params);
  const actual = Object.keys(record);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    throw new SmsHttpError(400, "Invalid request", "params keys");
  }

  const params: Record<string, string> = {};
  for (const [key, rule] of Object.entries(template.params)) {
    const raw = record[key];
    if (typeof raw !== "string") {
      throw new SmsHttpError(400, "Invalid request", "param type");
    }
    if (rule.kind === "enum") {
      if (!rule.values.includes(raw)) {
        throw new SmsHttpError(400, "Invalid request", "param enum");
      }
      params[key] = raw;
      continue;
    }
    if (raw.length === 0 || raw.length > rule.maxLength || !rule.pattern.test(raw)) {
      throw new SmsHttpError(400, "Invalid request", "param pattern");
    }
    params[key] = raw;
  }
  return params;
}

async function profilePhone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .select("phone, sms_opt_in")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    console.error("[send-sms] profile lookup failed");
    throw new SmsHttpError(500, "Unable to send SMS");
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length > 1) {
    console.warn(`[send-sms] multiple customer profiles for user ${userId}; using the newest`);
  }

  const newest: unknown = rows[0];
  if (newest === null || typeof newest !== "object") {
    throw new SmsHttpError(400, "Invalid request", "no profile phone");
  }
  const profile = newest as { phone?: unknown; sms_opt_in?: unknown };
  if (typeof profile.phone !== "string" || profile.phone.trim().length === 0 || profile.sms_opt_in === false) {
    throw new SmsHttpError(400, "Invalid request", "no sendable profile phone");
  }
  return profile.phone;
}

Deno.serve(async (req) => {
  const opened = openSmsPost(req);
  if (opened.response) return opened.response;
  const { cors } = opened;

  let logId: string | null = null;
  let admin: SupabaseClient | null = null;

  try {
    const config = readSmsConfig();
    const caller = await requireSmsUser(req);
    admin = caller.admin;
    const body = await readJsonObject(req);
    rejectUnknownKeys(body, ["template", "params"]);

    if (typeof body.template !== "string" || !(body.template in TEMPLATES)) {
      throw new SmsHttpError(400, "Invalid request", "unknown template");
    }
    const template = TEMPLATES[body.template];
    if (!template) {
      throw new SmsHttpError(400, "Invalid request", "unknown template");
    }
    const params = validateParams(template, body.params);
    const content = template.render(params);
    const phone = await profilePhone(caller.admin, caller.userId);
    const recipient = assertAllowedDestination(phone, config.allowedCountryCodes);

    const reserved = await reserveSmsSend({
      admin: caller.admin,
      userId: caller.userId,
      type: "notification",
      template: body.template,
      phoneDigits: recipient,
      userHourLimit: null,
      userDayLimit: 10,
      phoneHourLimit: null,
      globalDailyCap: config.dailyGlobalCap,
      codeHash: null,
    });
    logId = reserved.logId;

    const sent = await sendTransactionalSms({
      apiKey: config.apiKey,
      sender: config.sender,
      to: recipient,
      content,
      tag: body.template,
    });
    await markSmsSent(caller.admin, reserved.logId, sent.messageId);
    logId = null;
    console.info(`[send-sms] sent template=${body.template} last4=${recipient.slice(-4)}`);
    return jsonResponse(cors, 200, { sent: true });
  } catch (error) {
    if (logId && admin) await markSmsFailed(admin, logId, null);
    return smsErrorResponse(cors, error, "Unable to send SMS");
  }
});
