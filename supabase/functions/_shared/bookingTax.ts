/**
 * Server-side booking tax calculation (mirrors src/utils/bookingTaxCalculator.js).
 */

const round2 = (n: number) => Math.round(Number(n) * 100) / 100;

export type TaxLineItem = {
  key: string;
  label: string;
  amount: number;
  is_taxable: boolean;
  amountAfterDiscount?: number;
};

export function calculateTaxAmount(subtotal: number, taxRate: number): number {
  if (!Number.isFinite(subtotal) || subtotal < 0) return 0;
  if (!Number.isFinite(taxRate) || taxRate < 0) return 0;
  return round2(subtotal * (taxRate / 100));
}

export function allocateDiscount(lineItems: TaxLineItem[], discount: number): TaxLineItem[] {
  const d = Math.max(0, Number(discount) || 0);
  if (d <= 0 || !lineItems.length) {
    return lineItems.map((line) => ({ ...line, amountAfterDiscount: round2(line.amount) }));
  }
  const grossTotal = lineItems.reduce((sum, l) => sum + l.amount, 0);
  if (grossTotal <= 0) {
    return lineItems.map((line) => ({ ...line, amountAfterDiscount: 0 }));
  }
  let remainingDiscount = d;
  return lineItems.map((line, index) => {
    let lineDiscount: number;
    if (index === lineItems.length - 1) {
      lineDiscount = remainingDiscount;
    } else {
      lineDiscount = round2((line.amount / grossTotal) * d);
      remainingDiscount = round2(remainingDiscount - lineDiscount);
    }
    return {
      ...line,
      amountAfterDiscount: round2(Math.max(0, line.amount - lineDiscount)),
    };
  });
}

export function calculateTaxFromLineItems(
  lineItems: TaxLineItem[],
  taxRate: number,
  discount = 0
) {
  const discounted = allocateDiscount(lineItems, discount);
  let taxableSubtotal = 0;
  let nonTaxableSubtotal = 0;
  for (const line of discounted) {
    const amt = line.amountAfterDiscount ?? line.amount;
    if (line.is_taxable) taxableSubtotal += amt;
    else nonTaxableSubtotal += amt;
  }
  taxableSubtotal = round2(taxableSubtotal);
  nonTaxableSubtotal = round2(nonTaxableSubtotal);
  const subtotalBeforeTax = round2(taxableSubtotal + nonTaxableSubtotal);
  const tax = calculateTaxAmount(taxableSubtotal, taxRate);
  const total = round2(subtotalBeforeTax + tax);
  return {
    lineItems: discounted,
    taxableSubtotal,
    nonTaxableSubtotal,
    subtotalBeforeTax,
    tax,
    total,
    taxRate: taxRate || 0,
  };
}
