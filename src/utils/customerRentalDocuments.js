import { bookingHadInsurance } from '@/utils/rescheduleCalculations';
import { bookingIsCompanyDelivery } from '@/utils/bookingMileage';
import { serviceOffersDrivewayProtection } from '@/utils/protectionPlans';
import { isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

const COMPACT_EQUIPMENT_IDS = new Set([5, 8]);

export function bookingPlanId(booking) {
  return Number(booking?.plan?.id ?? booking?.plan_id);
}

function isCancelled(booking) {
  return String(booking?.status || '').toLowerCase().includes('cancel');
}

function isCompactEquipment(booking) {
  const id = bookingPlanId(booking);
  const name = String(booking?.plan?.name || '').toLowerCase();
  return (
    COMPACT_EQUIPMENT_IDS.has(id) ||
    name.includes('excavator') ||
    name.includes('skid') ||
    name.includes('telescop')
  );
}

function isCustomerTow(booking) {
  const id = bookingPlanId(booking);
  const plan = { ...(booking?.plan || {}), id };
  const isDelivery = Boolean(booking?.addons?.isDelivery || booking?.addons?.deliveryService);
  if (isSelfServiceTrailer(plan, isDelivery)) return true;
  const name = String(plan?.name || '').toLowerCase();
  return name.includes('trailer') && !bookingIsCompanyDelivery(booking);
}

function bookingLabel(booking) {
  const planName = formatCustomerFacingPlanName(booking?.plan?.name) || 'Rental';
  return `Booking #${booking.id} · ${planName}`;
}

function bookingsForKind(bookings, kind) {
  if (kind === 'master' || kind === 'terms') return bookings;
  if (kind === 'hpp') return bookings.filter((booking) => bookingHadInsurance(booking.addons));
  if (kind === 'driveway') {
    return bookings.filter((booking) => serviceOffersDrivewayProtection(booking.plan || bookingPlanId(booking)));
  }
  if (kind === 'delivery') return bookings.filter(bookingIsCompanyDelivery);
  if (kind === 'towing') return bookings.filter(isCustomerTow);
  if (kind === 'compact') return bookings.filter(isCompactEquipment);
  return [];
}

/**
 * Documents this customer signed, or that apply to their delivery type or equipment.
 */
export function customerRentalDocumentFlags(bookings = []) {
  const relevant = (bookings || []).filter((booking) => booking?.id && !isCancelled(booking));
  return {
    hpp: relevant.some((booking) => bookingHadInsurance(booking.addons)),
    driveway: relevant.some((booking) =>
      serviceOffersDrivewayProtection(booking.plan || bookingPlanId(booking)),
    ),
    drivewayAccepted: relevant.some((booking) => booking?.addons?.drivewayProtection === 'accept'),
    delivery: relevant.some(bookingIsCompanyDelivery),
    towing: relevant.some(isCustomerTow),
    compact: relevant.some(isCompactEquipment),
  };
}

export function buildCustomerRentalDocuments(bookings = []) {
  const relevant = (bookings || []).filter((booking) => booking?.id && !isCancelled(booking));
  if (!relevant.length) return [];

  const flags = customerRentalDocumentFlags(relevant);

  const definitions = [
    {
      key: 'master-rental-agreement',
      title: 'Master Rental Agreement',
      description: 'The rental agreement you signed. Service-specific terms apply to the equipment and delivery on your booking.',
      kind: 'master',
    },
    {
      key: 'terms-and-conditions',
      title: 'Terms and Conditions',
      description: 'Every terms section you accepted, plus protection and delivery terms that apply to your rental.',
      kind: 'terms',
    },
  ];

  if (flags.hpp) {
    definitions.push({
      key: 'hardware-protection-plan',
      title: 'Hardware Protection Plan',
      description: 'The hardware protection agreement for rentals where you purchased that plan.',
      kind: 'hpp',
    });
  }
  if (flags.driveway) {
    definitions.push({
      key: 'driveway-protection',
      title: 'Driveway Protection',
      description: 'Driveway protection terms for your dumpster delivery.',
      kind: 'driveway',
    });
  }
  if (flags.delivery) {
    definitions.push({
      key: 'delivery-and-placement',
      title: 'Delivery and Placement',
      description: 'Site access, placement, and delivery terms for rentals we deliver.',
      kind: 'delivery',
    });
  }
  if (flags.towing) {
    definitions.push({
      key: 'towing-and-transport',
      title: 'Towing and Transport',
      description: 'Towing and transport terms for equipment you pick up and tow.',
      kind: 'towing',
    });
  }
  if (flags.compact) {
    definitions.push({
      key: 'compact-equipment',
      title: 'Compact Equipment Rental',
      description: 'Operating terms for mini excavators, loaders, and other compact equipment on your booking.',
      kind: 'compact',
    });
  }

  return definitions.map((doc) => ({
    ...doc,
    appliesTo: bookingsForKind(relevant, doc.kind).map(bookingLabel),
    orderId: bookingsForKind(relevant, doc.kind)[0]?.id || relevant[0]?.id,
  }));
}

export function filterCustomerRentalDocuments(bookings, { category = 'All', searchQuery = '' } = {}) {
  if (category !== 'All' && category !== 'Document') return [];
  const documents = buildCustomerRentalDocuments(bookings);
  const query = String(searchQuery || '').trim().toLowerCase();
  if (!query) return documents;
  return documents.filter(
    (doc) => doc.title.toLowerCase().includes(query) || doc.description.toLowerCase().includes(query),
  );
}

export function findCustomerRentalDocument(bookings, documentKey) {
  if (!documentKey) return null;
  return buildCustomerRentalDocuments(bookings).find((doc) => doc.key === documentKey) || null;
}
