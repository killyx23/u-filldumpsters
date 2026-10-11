import React from 'react';
import { Link } from 'react-router-dom';

export const SMS_BUSINESS_NAME = 'U-Fill Dumpsters';
export const SMS_SUPPORT_EMAIL = 'support@u-filldumpsters.com';
export const SMS_SUPPORT_PHONE = '(801) 810-8832';
export const SMS_SUPPORT_PHONE_TEL = '+18018108832';

const linkClass = 'text-yellow-300 hover:text-yellow-200 underline';

export const SmsDisclosure = ({ className = 'text-sm text-blue-200 leading-relaxed' }) => (
  <p className={className}>
    By checking the optional box for order texts or marketing texts, you consent to receive those recurring text
    messages from {SMS_BUSINESS_NAME} at the mobile number provided, sent using an automated system. Consent is not a
    condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP
    for help. For additional assistance, contact{' '}
    <a href={`mailto:${SMS_SUPPORT_EMAIL}`} className={linkClass}>
      {SMS_SUPPORT_EMAIL}
    </a>{' '}
    or{' '}
    <a href={`tel:${SMS_SUPPORT_PHONE_TEL}`} className={linkClass}>
      {SMS_SUPPORT_PHONE}
    </a>
    . Carriers are not liable for any delayed or undelivered messages. Read our{' '}
    <Link to="/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
      Terms of Service
    </Link>{' '}
    and{' '}
    <Link to="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
      Privacy Policy
    </Link>
    . Your mobile information will not be sold or shared with third parties.
  </p>
);

export const SmsOptInFields = ({
  transactional = false,
  marketing = false,
  onTransactionalChange,
  onMarketingChange,
}) => {
  return (
    <div className="space-y-3 pl-1">
      <label className="flex items-start gap-3 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          name="smsTransactionalOptIn"
          checked={transactional === true}
          onChange={(e) => onTransactionalChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-yellow-400"
        />
        <span>
          Send me order text messages from {SMS_BUSINESS_NAME}, such as booking confirmations, pickup and delivery
          updates, and access codes.
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          name="smsMarketingOptIn"
          checked={marketing === true}
          onChange={(e) => onMarketingChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-yellow-400"
        />
        <span>
          Send me marketing text messages from {SMS_BUSINESS_NAME} about offers and promotions. This choice is
          separate from order texts and from email.
        </span>
      </label>
      <SmsDisclosure />
    </div>
  );
};
