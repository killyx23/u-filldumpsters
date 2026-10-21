import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { currentReturnPath, markSmsReturnPending } from '@/utils/smsFormReturn';

export const SMS_BUSINESS_NAME = 'U-Fill Dumpsters';
export const SMS_SUPPORT_EMAIL = 'support@u-filldumpsters.com';
export const SMS_SUPPORT_PHONE = '(855) 591-7723';
export const SMS_SUPPORT_PHONE_TEL = '+18555917723';

const linkClass = 'text-yellow-300 hover:text-yellow-200 underline';

export const SMS_TRANSACTIONAL_USE_CASES =
  'booking confirmations, pickup and delivery updates, and access codes';

export const SmsDisclosure = ({ className = 'text-sm text-blue-200 leading-relaxed' }) => (
  <p className={className}>
    Order texts and marketing texts are each optional and are not a condition of purchase. Messages are sent to the
    mobile number provided using an automated system. For additional assistance, contact{' '}
    <a href={`mailto:${SMS_SUPPORT_EMAIL}`} className={linkClass}>
      {SMS_SUPPORT_EMAIL}
    </a>{' '}
    or{' '}
    <a href={`tel:${SMS_SUPPORT_PHONE_TEL}`} className={linkClass}>
      {SMS_SUPPORT_PHONE}
    </a>
    . Carriers are not liable for any delayed or undelivered messages. Your mobile information will not be sold or
    shared with third parties.
  </p>
);

export const SmsOptInFields = ({
  transactional = false,
  marketing = false,
  onTransactionalChange,
  onMarketingChange,
  policiesAccepted = false,
  onPoliciesAcceptedChange,
}) => {
  const location = useLocation();
  const returnTo = currentReturnPath(location);
  const openPolicy = (event) => {
    event.stopPropagation();
    markSmsReturnPending(returnTo);
  };

  return (
    <div className="space-y-3 pl-1">
      <p className="text-sm font-semibold text-yellow-300">{SMS_BUSINESS_NAME}</p>
      <label className="flex items-start gap-3 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          name="smsTransactionalOptIn"
          checked={transactional === true}
          onChange={(e) => onTransactionalChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-yellow-400"
        />
        <span>
          By checking this box and submitting this form, you consent to receive transactional text messages for{' '}
          {SMS_TRANSACTIONAL_USE_CASES} from {SMS_BUSINESS_NAME}. Reply STOP to opt out. Reply HELP for help. Standard
          message and data rates may apply. Message frequency may vary.
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
          By checking this box and submitting this form, you consent to receive text messages for marketing from{' '}
          {SMS_BUSINESS_NAME}. Reply STOP to opt out. Reply HELP for help. Message and data rates may apply. Message
          frequency may vary.
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          name="smsPoliciesAccepted"
          checked={policiesAccepted === true}
          onChange={(e) => onPoliciesAcceptedChange?.(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-yellow-400"
        />
        <span>
          I agree to the{' '}
          <Link to="/terms" state={{ returnTo }} className={linkClass} onClick={openPolicy}>
            Terms and Conditions
          </Link>{' '}
          and{' '}
          <Link to="/privacy" state={{ returnTo }} className={linkClass} onClick={openPolicy}>
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      <SmsDisclosure />
    </div>
  );
};
