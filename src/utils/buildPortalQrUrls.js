import { getAppOrigin } from '@/utils/getAppOrigin';

const normalizeValue = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export function buildAccessCodesQrUrl({ token, portalNumber, phone, orderId }) {
  const params = new URLSearchParams();
  params.set('tab', 'access-codes');

  const normalizedToken = normalizeValue(token);
  const normalizedPortal = normalizeValue(portalNumber);
  const normalizedPhone = normalizeValue(phone);
  const normalizedOrderId = normalizeValue(orderId);

  if (normalizedToken) params.set('token', normalizedToken);
  if (normalizedPortal) params.set('portal_number', normalizedPortal);
  if (normalizedPhone) params.set('phone', normalizedPhone);
  if (normalizedOrderId) params.set('order_id', normalizedOrderId);

  return `${getAppOrigin()}/customer-portal?${params.toString()}`;
}

export function buildHowToGuidesQrUrl({ portalNumber, phone }) {
  const params = new URLSearchParams();
  params.set('tab', 'resources');

  const normalizedPortal = normalizeValue(portalNumber);
  const normalizedPhone = normalizeValue(phone);

  if (normalizedPortal) params.set('portal_number', normalizedPortal);
  if (normalizedPhone) params.set('phone', normalizedPhone);

  return `${getAppOrigin()}/customer-portal?${params.toString()}`;
}
