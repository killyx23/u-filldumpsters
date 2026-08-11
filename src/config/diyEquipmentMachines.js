/**
 * DIY Heavy Equipment machine picker (homepage service id 5 → choose machine).
 * Service 5 = Mini Excavator; service 8 = Mini Telescoping Loader 3 in 1.
 */

import { siteImages } from '@/config/siteImages';

export const DIY_HOMEPAGE_SERVICE_ID = 5;

export const DIY_EQUIPMENT_MACHINES = [
  {
    serviceId: 5,
    title: 'Mini Excavator',
    description:
      'Compact excavator for digging, trenching, grading, and small excavation projects.',
    image: siteImages.miniExcavator,
  },
  {
    serviceId: 8,
    title: 'Mini Telescoping Loader 3 in 1',
    description:
      'Compact telescoping loader for lifting, loading, and backyard material moving.',
    image: siteImages.miniTelescopingLoader,
  },
];

export const DIY_MACHINE_SERVICE_IDS = DIY_EQUIPMENT_MACHINES.map((m) => m.serviceId);

/** @param {number|string|null|undefined} serviceId */
export function isDiyHomepageService(serviceId) {
  return Number(serviceId) === DIY_HOMEPAGE_SERVICE_ID;
}

/** @param {number|string|null|undefined} serviceId */
export function isDiyMachineService(serviceId) {
  return DIY_MACHINE_SERVICE_IDS.includes(Number(serviceId));
}

/** Homepage catalog still shows this label for service id 5. */
export const DIY_HOMEPAGE_DISPLAY_NAME = 'DIY Heavy Equipment';
