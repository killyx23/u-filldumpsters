export const DEFAULT_PROTECTION_OPTIONS_INFO_DESCRIPTION =
  "Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery.";

export const buildDumpLoaderProtectionOptionsInfoDescription = (creditLimit = '$500.00') =>
  `🛡️ Sure-Trac Hardware Protection offers up to a ${creditLimit} credit toward repair or replacement costs for accidental damage to key trailer systems, including auto-tarping, wireless remotes, hydraulics, and lighting.\n\nThis plan reduces out-of-pocket expenses, but explicitly excludes damages resulting from misuse, negligence, beyond normal wear and tear, cosmetic issues, and damage to tires or personal property (see the full contract for all details). Lost remotes are not covered.`;

export const DUMP_LOADER_PROTECTION_OPTIONS_INFO_DESCRIPTION =
  buildDumpLoaderProtectionOptionsInfoDescription();

export const isDumpLoaderProtectionInfoService = (serviceName = "") => {
  const normalizedServiceName = serviceName.toLowerCase();
  return (
    (normalizedServiceName.includes("dump loader") ||
      normalizedServiceName.includes("dump trailer") ||
      normalizedServiceName.includes("loader trailer")) &&
    !normalizedServiceName.includes("16 yard") &&
    !normalizedServiceName.includes("dumpster")
  );
};

export const getProtectionOptionsInfoDescription = (serviceName = "", creditLimit) =>
  isDumpLoaderProtectionInfoService(serviceName)
    ? buildDumpLoaderProtectionOptionsInfoDescription(creditLimit)
    : DEFAULT_PROTECTION_OPTIONS_INFO_DESCRIPTION;
