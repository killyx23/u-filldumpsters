/**
 * Brevo transactional SMS.
 * Endpoint confirmed against https://developers.brevo.com/docs/transactional-sms-endpoints :
 * POST https://api.brevo.com/v3/transactionalSMS/send
 * The documented 201 body guarantees messageId. smsCount, usedCredits, and
 * remainingCredits are returned when Brevo includes them.
 */

const BREVO_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/send";

export class BrevoSmsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BrevoSmsError";
    this.status = status;
  }
}

export type TransactionalSmsResult = {
  messageId: string;
  smsCount: number | null;
  usedCredits: number | null;
  remainingCredits: number | null;
};

export type SendTransactionalSmsInput = {
  apiKey: string;
  sender: string;
  to: string;
  content: string;
  tag?: string;
};

/** Digits only, no +, 00, spaces, or dashes. Example: 18015551234. */
export function toBrevoRecipient(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    throw new BrevoSmsError(400, "Invalid phone number");
  }

  let digits = trimmed;
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/[\s().-]/g, "");

  if (!/^[0-9]{8,15}$/.test(digits)) {
    throw new BrevoSmsError(400, "Invalid phone number");
  }
  return digits;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMessageId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 64) return value;
  throw new BrevoSmsError(502, "Brevo response did not include a message id");
}

async function errorFromResponse(response: Response): Promise<BrevoSmsError> {
  let message = "Brevo rejected the SMS";
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && "message" in body) {
      const candidate = body.message;
      if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 300) {
        message = candidate;
      }
    }
  } catch {
    message = "Brevo rejected the SMS";
  }
  return new BrevoSmsError(response.status, message);
}

export async function sendTransactionalSms(
  input: SendTransactionalSmsInput,
): Promise<TransactionalSmsResult> {
  const recipient = toBrevoRecipient(input.to);
  if (input.content.length === 0 || input.content.length > 160) {
    throw new BrevoSmsError(400, "Invalid SMS content");
  }
  if (/\bstop\b/i.test(input.content)) {
    throw new BrevoSmsError(400, "Invalid SMS content");
  }

  const payload: {
    sender: string;
    recipient: string;
    content: string;
    type: "transactional";
    tag?: string;
  } = {
    sender: input.sender,
    recipient,
    content: input.content,
    type: "transactional",
  };
  if (input.tag) payload.tag = input.tag;

  const response = await fetch(BREVO_SMS_URL, {
    method: "POST",
    headers: {
      "api-key": input.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  const body: unknown = await response.json();
  if (body === null || typeof body !== "object") {
    throw new BrevoSmsError(502, "Brevo response was not JSON");
  }

  const record = body as Record<string, unknown>;
  return {
    messageId: readMessageId(record.messageId),
    smsCount: optionalNumber(record.smsCount),
    usedCredits: optionalNumber(record.usedCredits),
    remainingCredits: optionalNumber(record.remainingCredits),
  };
}
