/** Fee objects only. Skip history arrays such as rental_extension_history. */
export function feeChargeEntries(fees) {
  if (!fees || typeof fees !== 'object' || Array.isArray(fees)) return [];
  return Object.entries(fees).filter(([key, fee]) => {
    if (String(key).endsWith('_history')) return false;
    if (!fee || typeof fee !== 'object' || Array.isArray(fee)) return false;
    return Number.isFinite(Number(fee.amount));
  });
}

export function feeIsCharged(fee) {
  return Boolean(
    fee &&
    typeof fee === 'object' &&
    !Array.isArray(fee) &&
    typeof fee.charge_id === 'string' &&
    fee.charge_id.startsWith('ch_'),
  );
}
