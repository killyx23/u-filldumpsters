import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export const SMS_BUSINESS_NAME = 'U-Fill Dumpsters';
export const SMS_SUPPORT_EMAIL = 'support@u-filldumpsters.com';
export const SMS_SUPPORT_PHONE = '(801) 810-8832';
export const SMS_SUPPORT_PHONE_TEL = '+18018108832';

export const SmsDisclosure = ({ className = 'text-sm text-blue-200 leading-relaxed' }) => (
  <p className={className}>
    By providing your mobile phone number, you agree to receive text messages from {SMS_BUSINESS_NAME} at the
    number provided, sent using an automated system. Consent is not a condition of purchase. Message frequency
    varies. Message and data rates may apply. Reply STOP to cancel or HELP for help. For additional assistance,
    contact{' '}
    <a href={`mailto:${SMS_SUPPORT_EMAIL}`} className="text-yellow-300 hover:text-yellow-200 underline">
      {SMS_SUPPORT_EMAIL}
    </a>{' '}
    or{' '}
    <a href={`tel:${SMS_SUPPORT_PHONE_TEL}`} className="text-yellow-300 hover:text-yellow-200 underline">
      {SMS_SUPPORT_PHONE}
    </a>
    . Carriers are not liable for any delayed or undelivered messages. See our{' '}
    <Link
      to="/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="text-yellow-300 hover:text-yellow-200 underline"
    >
      Privacy Policy
    </Link>{' '}
    for how we handle your personal information. Your mobile information will not be sold or shared with third parties.
  </p>
);

export const SmsOptInFields = ({
  transactional = false,
  marketing = false,
  onTransactionalChange,
  onMarketingChange,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);

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
        <span>Send me transactional text messages about my order, such as booking confirmations, pickup and delivery updates, and access codes.</span>
      </label>
      <label className="flex items-start gap-3 text-sm text-white cursor-pointer">
        <input
          type="checkbox"
          name="smsMarketingOptIn"
          checked={marketing === true}
          onChange={(e) => onMarketingChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-yellow-400"
        />
        <span>Send me marketing text messages about offers and promotions. This choice is separate from order texts and from email.</span>
      </label>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="rounded-lg border border-white/15 bg-black/20">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5">
          <span className="font-semibold text-yellow-400">Text Message Privacy Details</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-yellow-400 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <SmsDisclosure />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
