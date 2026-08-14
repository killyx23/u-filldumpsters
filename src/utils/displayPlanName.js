/**
 * Customer- and staff-facing plan name. Stored bookings may still say
 * "Dump Loader Trailer" or "16 Yard Dumpster Rental"; show current names instead.
 */
export function formatCustomerFacingPlanName(name) {
  if (name == null || name === '') return name;
  const text = String(name);
  return text
    .replace(/Dump Loader Trailers/g, 'Dump Trailers')
    .replace(/dump loader trailers/g, 'dump trailers')
    .replace(/Dump Loader Trailer/g, 'Dump Trailer')
    .replace(/dump loader trailer/g, 'dump trailer')
    .replace(/Dump Loader/g, 'Dump Trailer')
    .replace(/dump loader/g, 'dump trailer')
    .replace(/16[- ]Yard Dumpster Rentals/g, 'Dumpster Rentals')
    .replace(/16[- ]yard dumpster rentals/g, 'dumpster rentals')
    .replace(/16[- ]Yard Dumpster Rental/g, 'Dumpster Rental')
    .replace(/16[- ]yard dumpster rental/g, 'dumpster rental')
    .replace(/16[- ]Yard Dumpster/g, 'Dumpster Rental')
    .replace(/16[- ]yard dumpster/g, 'dumpster rental');
}

/** True if a plan name refers to the dump trailer product (old or new wording). */
export function mentionsDumpTrailer(name) {
  const n = String(name || '').toLowerCase();
  return n.includes('dump loader') || n.includes('dump trailer');
}
