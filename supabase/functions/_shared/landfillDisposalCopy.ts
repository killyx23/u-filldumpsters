/** Shared landfill / dump fee customer copy for emails and SMS. */

const DEFAULT_RATE = 45;
const DEFAULT_TONS = 1;

export function formatLandfillTonCount(tons: unknown): string {
  if (tons == null || tons === "") return "1";
  const amount = Number(tons);
  if (!Number.isFinite(amount)) return "1";
  return String(Number(amount.toFixed(2)));
}

export function formatMoney(value: unknown): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function formatLbsFromTons(tons: unknown): string {
  const amount = Number(tons);
  if (!Number.isFinite(amount)) return "2,000";
  return Math.round(amount * 2000).toLocaleString("en-US");
}

export const DUMP_FLAT_RATE_CHARGE_NOTE = "(Charged upon the completion of delivery)";

/** "Your rental includes up to 1 ton (2,000 lbs) for only $45.00 Flat Rate." */
export function includedDumpFlatRateSentence(rate: unknown, tons: unknown): string {
  const tonCount = formatLandfillTonCount(tons);
  const lbs = formatLbsFromTons(Number(tonCount));
  const tonWord = tonCount === "1" ? "ton" : "tons";
  return `Your rental includes up to ${tonCount} ${tonWord} (${lbs} lbs) for only ${formatMoney(rate)} Flat Rate.`;
}

/** Plain-text body (SMS / fallback). */
export function pendingDumpFeesBody(rate: unknown, tons: unknown): string {
  return `Pending dump fees are calculated based on actual waste processed. ${includedDumpFlatRateSentence(rate, tons)} ${DUMP_FLAT_RATE_CHARGE_NOTE}`;
}

/** HTML body for emails — charge note is smaller + italic. */
export function pendingDumpFeesBodyHtml(rate: unknown, tons: unknown): string {
  return `Pending dump fees are calculated based on actual waste processed. ${includedDumpFlatRateSentence(rate, tons)} <em style="font-size:0.85em;">${DUMP_FLAT_RATE_CHARGE_NOTE}</em>`;
}

export type LandfillRateFees = {
  dump_tonnage_rate: number;
  dump_rate_tons: number;
};

export function landfillRatesFromRows(
  rows: Array<{ fee_key?: string | null; fee_value?: unknown }> | null | undefined,
): LandfillRateFees {
  const fees: LandfillRateFees = {
    dump_tonnage_rate: DEFAULT_RATE,
    dump_rate_tons: DEFAULT_TONS,
  };
  for (const row of rows || []) {
    if (row?.fee_key === "dump_tonnage_rate") {
      const value = Number(row.fee_value);
      if (Number.isFinite(value)) fees.dump_tonnage_rate = value;
    }
    if (row?.fee_key === "dump_rate_tons") {
      const value = Number(row.fee_value);
      if (Number.isFinite(value)) fees.dump_rate_tons = value;
    }
  }
  return fees;
}
