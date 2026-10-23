/**
 * Customer-portal links that sign the customer in.
 * Same query names as the receipt QR links: portal_number and phone.
 */

export type PortalLinkOptions = {
  tab?: string;
  section?: string;
  portalNumber?: string | null;
  phone?: string | null;
  orderId?: string | number | null;
};

function usable(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return "";
  return trimmed;
}

export function buildCustomerPortalUrl(siteUrl: string, options: PortalLinkOptions = {}): string {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (options.tab) params.set("tab", options.tab);
  if (options.section) params.set("section", options.section);
  const portalNumber = usable(options.portalNumber);
  const phone = usable(options.phone);
  if (portalNumber) params.set("portal_number", portalNumber);
  if (phone) params.set("phone", phone);
  if (options.orderId != null && String(options.orderId).trim()) {
    params.set("order_id", String(options.orderId).trim());
  }
  const query = params.toString();
  return query ? `${base}/customer-portal?${query}` : `${base}/customer-portal`;
}

export function portalCredentialsFromBooking(booking: {
  customers?: { customer_id_text?: string | null; phone?: string | null } | null;
  customer_id_text?: string | null;
  phone?: string | null;
} | null | undefined): { portalNumber: string; phone: string } {
  const customer = booking?.customers;
  return {
    portalNumber: usable(customer?.customer_id_text || booking?.customer_id_text),
    phone: usable(customer?.phone || booking?.phone),
  };
}
