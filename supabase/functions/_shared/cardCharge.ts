/**
 * Charge a saved card and require a real Stripe charge id (ch_…).
 * Invoice status "paid" is not enough: a customer balance can pay an invoice
 * without ever charging the card.
 */
import { Stripe } from "npm:stripe@15.8.0";

export function chargeIdFrom(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("ch_")) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.startsWith("ch_")) return id;
  }
  return null;
}

export async function resolvePaymentIntentChargeId(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== "succeeded") return null;
  const direct = chargeIdFrom(pi.latest_charge);
  if (direct) return direct;
  const listed = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
  return chargeIdFrom(listed.data[0]?.id);
}

export async function resolveInvoiceChargeId(
  stripe: Stripe,
  invoiceId: string,
): Promise<{ chargeId: string | null; status: string | null; paymentIntentId: string | null }> {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const paymentIntentId = typeof invoice.payment_intent === "string"
    ? invoice.payment_intent
    : invoice.payment_intent?.id ?? null;
  let chargeId = chargeIdFrom(invoice.latest_charge);
  if (!chargeId && paymentIntentId) {
    chargeId = await resolvePaymentIntentChargeId(stripe, paymentIntentId);
  }
  return { chargeId, status: invoice.status ?? null, paymentIntentId };
}

async function defaultCardId(stripe: Stripe, stripeCustomerId: string): Promise<string> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) throw new Error("Stripe customer no longer exists.");
  const preferred = customer.invoice_settings?.default_payment_method;
  if (typeof preferred === "string" && preferred) return preferred;
  if (preferred && typeof preferred === "object" && "id" in preferred && preferred.id) {
    return preferred.id;
  }
  const methods = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
    limit: 1,
  });
  const cardId = methods.data[0]?.id;
  if (!cardId) throw new Error("No card on file for this customer.");
  return cardId;
}

/**
 * Off-session charge against the customer's default card.
 * Throws unless Stripe returns a ch_ id. Does not write the fee row.
 */
export async function chargeCardOffSession(
  stripe: Stripe,
  stripeCustomerId: string,
  amountCents: number,
  description: string,
  metadata: Record<string, string>,
  idempotencyKey: string,
): Promise<{ chargeId: string; paymentIntentId: string }> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  const paymentMethodId = await defaultCardId(stripe, stripeCustomerId);
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: stripeCustomerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    description,
    metadata,
  }, { idempotencyKey });

  if (pi.status !== "succeeded") {
    throw new Error(`Card was not charged (status ${pi.status}). The fee was not saved.`);
  }
  const chargeId = chargeIdFrom(pi.latest_charge) ||
    await resolvePaymentIntentChargeId(stripe, pi.id);
  if (!chargeId) {
    throw new Error("Stripe did not return a card charge id. The fee was not saved.");
  }
  return { chargeId, paymentIntentId: pi.id };
}
