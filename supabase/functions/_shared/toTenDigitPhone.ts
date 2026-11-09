/**
 * Normalize a US phone to exactly 10 digits.
 * Strips non-digits; drops a leading country-code 1 when 11 digits.
 * Returns '' when the value cannot be normalized to 10 digits.
 */
export function toTenDigitPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}
