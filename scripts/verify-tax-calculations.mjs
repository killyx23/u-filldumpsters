/**
 * Tax calculation verification script (standalone, no bundler aliases).
 * Run: node scripts/verify-tax-calculations.mjs
 */

function calculateTaxAmount(subtotal, taxRate) {
  const taxAmount = subtotal * (taxRate / 100);
  return Math.round(taxAmount * 100) / 100;
}

function calculateTotalWithTax(subtotal, taxRate) {
  const taxAmount = calculateTaxAmount(subtotal, taxRate);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: taxAmount,
    total: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}

function allocateDiscount(lineItems, discount) {
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
    let lineDiscount;
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

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function calculateTaxFromLineItems(lineItems, taxRate, discount = 0) {
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
  return { taxableSubtotal, nonTaxableSubtotal, subtotalBeforeTax, tax, total };
}

const taxRate = 7.45;
const subtotal = 335;
const expected = calculateTotalWithTax(subtotal, taxRate);

console.log('=== calculateTotalWithTax (legacy flat subtotal) ===');
console.log(`Subtotal: $${subtotal}`);
console.log(`Tax (${taxRate}%): $${expected.tax}`);
console.log(`Total: $${expected.total}`);

const pass1 = expected.tax === 24.96 && expected.total === 359.96;
console.log(pass1 ? 'PASS' : 'FAIL', '- expected tax $24.96, total $359.96');

console.log('\n=== mixed taxable / non-taxable ===');
const mixedLines = [
  { key: 'base_rental', amount: 300, is_taxable: true },
  { key: 'insurance', amount: 25, is_taxable: false },
  { key: 'delivery_fee', amount: 10, is_taxable: true },
];
const mixed = calculateTaxFromLineItems(mixedLines, taxRate);
console.log(`Taxable: $${mixed.taxableSubtotal}, Non-taxable: $${mixed.nonTaxableSubtotal}`);
console.log(`Tax: $${mixed.tax}, Total: $${mixed.total}`);
// Tax only on $310 -> 23.10, total 335 + 23.10 = 358.10
const passMixed =
  mixed.taxableSubtotal === 310 &&
  mixed.nonTaxableSubtotal === 25 &&
  mixed.tax === 23.1 &&
  mixed.total === 358.1;
console.log(passMixed ? 'PASS' : 'FAIL', '- insurance excluded from tax base');

console.log('\n=== coupon on mixed cart ===');
const withCoupon = calculateTaxFromLineItems(mixedLines, taxRate, 31);
// $31 off $335 gross -> proportional; tax on reduced taxable portion
const passCoupon = withCoupon.subtotalBeforeTax === 304 && withCoupon.total > 304;
console.log(`Subtotal after discount: $${withCoupon.subtotalBeforeTax}, Total: $${withCoupon.total}`);
console.log(passCoupon ? 'PASS' : 'FAIL', '- coupon reduces subtotal before tax');

console.log('\n=== insurance-only non-taxable add-on ===');
const rentalOnly = calculateTaxFromLineItems(
  [{ key: 'base', amount: 100, is_taxable: true }],
  taxRate
);
const withIns = calculateTaxFromLineItems(
  [
    { key: 'base', amount: 100, is_taxable: true },
    { key: 'insurance', amount: 25, is_taxable: false },
  ],
  taxRate
);
const taxDiff = withIns.tax - rentalOnly.tax;
const passIns = taxDiff === 0 && withIns.total === rentalOnly.total + 25;
console.log(passIns ? 'PASS' : 'FAIL', '- insurance adds to total but not tax');

const allPass = pass1 && passMixed && passCoupon && passIns;
if (!allPass) {
  process.exit(1);
}

console.log('\nAll tax calculation checks passed.');
