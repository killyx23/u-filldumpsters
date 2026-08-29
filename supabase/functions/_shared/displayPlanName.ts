/** Customer-facing plan name. Remaps stored Dump Loader / 16 Yard Dumpster / DIY Heavy Equipment labels. */
export function formatCustomerFacingPlanName(name: unknown): string {
  if (name == null || name === "") return name == null ? "" : String(name);
  return String(name)
    .replace(/Dump Loader Trailers/g, "Dump Trailers")
    .replace(/dump loader trailers/g, "dump trailers")
    .replace(/Dump Loader Trailer/g, "Dump Trailer")
    .replace(/dump loader trailer/g, "dump trailer")
    .replace(/Dump Loader/g, "Dump Trailer")
    .replace(/dump loader/g, "dump trailer")
    .replace(/16[- ]Yard Dumpster Rentals/g, "Dumpster Rentals")
    .replace(/16[- ]yard dumpster rentals/g, "dumpster rentals")
    .replace(/16[- ]Yard Dumpster Rental/g, "Dumpster Rental")
    .replace(/16[- ]yard dumpster rental/g, "dumpster rental")
    .replace(/16[- ]Yard Dumpster/g, "Dumpster Rental")
    .replace(/16[- ]yard dumpster/g, "dumpster rental")
    .replace(/Do-It-Yourself \(DIY\) Heavy Equipment/g, "Compact Equipment Rental")
    .replace(/do-it-yourself \(diy\) heavy equipment/g, "compact equipment rental")
    .replace(/DIY Heavy Equipment/g, "Compact Equipment Rental")
    .replace(/diy heavy equipment/g, "compact equipment rental")
    .replace(/Compact Equipment(?! Rental)/g, "Compact Equipment Rental")
    .replace(/compact equipment(?! rental)/g, "compact equipment rental");
}
