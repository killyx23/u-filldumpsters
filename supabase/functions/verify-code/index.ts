import {
  hashVerificationCode,
  jsonResponse,
  openSmsPost,
  readJsonObject,
  readSmsConfig,
  rejectUnknownKeys,
  requireSmsUser,
  SmsHttpError,
  smsErrorResponse,
  timingSafeEqual,
} from "../_shared/sms-guard.ts";

type StoredCode = {
  id: string;
  phone_number: string;
  code_hash: string;
};

function isStoredCode(value: unknown): value is StoredCode {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    typeof record.phone_number === "string" &&
    typeof record.code_hash === "string";
}

Deno.serve(async (req) => {
  const opened = openSmsPost(req);
  if (opened.response) return opened.response;
  const { cors } = opened;

  try {
    const config = readSmsConfig();
    const caller = await requireSmsUser(req);
    const body = await readJsonObject(req);
    rejectUnknownKeys(body, ["code"]);
    if (typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code)) {
      throw new SmsHttpError(400, "Invalid or expired code");
    }

    const { data, error } = await caller.admin
      .from("sms_verification_codes")
      .select("id, phone_number, code_hash")
      .eq("user_id", caller.userId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[verify-code] lookup failed");
      throw new SmsHttpError(500, "Unable to verify code");
    }

    const stored = isStoredCode(data) ? data : null;
    const submittedHash = stored
      ? await hashVerificationCode(config.hmacSecret, caller.userId, stored.phone_number, body.code)
      : await hashVerificationCode(config.hmacSecret, caller.userId, "0", body.code);
    const matched = stored ? timingSafeEqual(submittedHash, stored.code_hash) : timingSafeEqual(submittedHash, "0".repeat(64));

    if (!stored) {
      throw new SmsHttpError(400, "Invalid or expired code", "no active code");
    }

    const { data: result, error: attemptError } = await caller.admin.rpc("record_sms_code_attempt", {
      p_id: stored.id,
      p_user_id: caller.userId,
      p_match: matched,
    });
    if (attemptError) {
      console.error("[verify-code] attempt was not recorded");
      throw new SmsHttpError(500, "Unable to verify code");
    }
    if (result === null || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
      const reason = result !== null && typeof result === "object" && typeof (result as { reason?: unknown }).reason === "string"
        ? (result as { reason: string }).reason
        : "rejected";
      throw new SmsHttpError(400, "Invalid or expired code", reason);
    }

    // customers has phone and sms_opt_in, but no column that means "phone verified".
    // The code is consumed here. The profile phone is not changed until that column is confirmed.
    console.info(`[verify-code] verified user=${caller.userId} last4=${stored.phone_number.slice(-4)}`);
    return jsonResponse(cors, 200, { verified: true });
  } catch (error) {
    return smsErrorResponse(cors, error, "Unable to verify code");
  }
});
