import { isInsuranceAddon, resolveNumericEquipmentId } from '@/utils/rescheduleCalculations';

const DISPOSAL_EQUIPMENT_IDS = new Set([4, 5, 6]);

export function isDisposalAddonId(id) {
  const numericId = Number(id);
  return DISPOSAL_EQUIPMENT_IDS.has(numericId);
}

export function isDrivewayAddon(addon) {
  if (!addon) return false;
  if (addon.id === 'driveway' || addon.type === 'driveway') return true;
  const name = (addon.name || '').toLowerCase();
  return name.includes('driveway protection');
}

/** Dumpster delivery is the only service that offers driveway protection. */
export function serviceSupportsDriveway(serviceId) {
  return Number(serviceId) === 1;
}

/** Mirror AddonsForm: disposal hidden for dump loader self-pickup (service 2). */
export function isAddonApplicableToService(addon, serviceId) {
  const id = Number(serviceId);
  if (!addon) return false;

  if (isInsuranceAddon(addon)) return true;

  if (isDrivewayAddon(addon)) {
    return serviceSupportsDriveway(id);
  }

  const equipId = resolveNumericEquipmentId(addon);
  if (equipId && isDisposalAddonId(equipId)) {
    return id !== 2;
  }

  return true;
}

export function filterAddonsForService(addonsList = [], serviceId) {
  return (addonsList || []).filter((addon) => isAddonApplicableToService(addon, serviceId));
}

/**
 * Ensure original booking items that apply to the selected service stay pre-checked with original quantities.
 */
export function mergeOriginalAddonsForService(originalList = [], currentList = [], serviceId) {
  const applicableOriginals = filterAddonsForService(originalList, serviceId);
  const filteredCurrent = filterAddonsForService(currentList, serviceId);
  const merged = new Map();

  for (const item of filteredCurrent) {
    const key = item.id === 'insurance' || item.id === 'driveway' ? item.id : (resolveNumericEquipmentId(item) ?? item.id);
    merged.set(key, item);
  }

  for (const original of applicableOriginals) {
    const key = original.id === 'insurance' || original.id === 'driveway' ? original.id : (resolveNumericEquipmentId(original) ?? original.id);
    if (!merged.has(key)) {
      merged.set(key, { ...original });
    } else {
      const existing = merged.get(key);
      merged.set(key, {
        ...existing,
        quantity: original.quantity ?? existing.quantity ?? 1,
        price: existing.price ?? original.price,
      });
    }
  }

  return Array.from(merged.values());
}

export function filterAvailableAddonsForService(addons = [], serviceId, { hasDrivewayPlan = false } = {}) {
  return (addons || []).filter((addon) => {
    if (isDrivewayAddon(addon) && !hasDrivewayPlan) return false;
    return isAddonApplicableToService(addon, serviceId);
  });
}
