import React from 'react';
import { formatMoney, formatPercent, formatTons } from '@/utils/chargesAndFeesConfig';

export const buildTermsSections = (fee) => [
  {
    id: 'email',
    title: 'Email & Text Message Communication',
    summary: 'Consent to email verification and order-related text (SMS) communication.',
    content: (
      <>
        <p>
          I understand that I must verify my email address to complete this booking. All order confirmations, receipts,
          and critical updates will be sent to this email.
        </p>
        <p>
          U-Fill Dumpsters LLC may use this email to communicate regarding scheduling, delays, or issues with the
          rental. Your contact information will not be sold to third parties.
        </p>
        <p>
          By providing my mobile phone number, I consent to receive text messages (SMS/MMS) from U-Fill Dumpsters LLC
          about my order and rental, including booking confirmations, pickup and delivery updates, access codes,
          scheduling changes, and other account-related notices. Message and data rates may apply. Message frequency
          varies. Consent to receive text messages is not required as a condition of purchase. I may opt out at any time
          by replying STOP to a text message or by contacting U-Fill Dumpsters LLC customer support.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Liability & Damage Responsibility',
    summary: 'Responsibility for equipment and property damage during rental.',
    content: (
      <>
        <p>
          Customer assumes all risk of loss, theft, damage, or injury associated with the Equipment during the Rental
          Period, except to the extent caused by Company&apos;s gross negligence or willful misconduct.
        </p>
        <p>
          Customer is responsible for repair or replacement costs for any damage to Equipment beyond normal wear and
          tear. U-Fill Dumpsters is not liable for damage to driveways, lawns, or property resulting from standard
          delivery (if applicable) and usage of the equipment, unless Driveway Protection or Hardware Protection was
          explicitly purchased and utilized, where applicable.
        </p>
      </>
    ),
  },
  {
    id: 'general',
    title: 'General Terms & Cancellation Policy',
    summary: 'Cancellation fees, refunds, and general rental conditions.',
    content: (
      <>
        <p>
          <strong>Cancellations more than 24 hours before scheduled delivery:</strong>{' '}
          {formatPercent(fee('advance_cancel_percentage'))}% cancellation fee of the order total retained; balance
          refunded.
        </p>
        <p>
          <strong>Cancellations 24 hours or less before scheduled delivery:</strong> Up to{' '}
          {formatPercent(fee('late_cancel_percentage'))}% of the order total charged, plus a{' '}
          {formatPercent(fee('advance_cancel_percentage'))}% cancellation fee of the order total retained.
        </p>
        <p>
          No-shows or refusal of equipment at delivery may result in full rental charges. Refunds are processed within
          one to two business days and should reflect in accounts within 5-10 business days. But, except in some rare
          cases, it can be up to 30 days from the date canceled.
        </p>
      </>
    ),
  },
  {
    id: 'payment',
    title: 'Payment Terms & Pricing',
    summary: 'Overweight fees, disposal charges, and payment authorization.',
    content: (
      <>
        <p>
          Full payment, including taxes and applicable add-ons, is due at booking to secure the reservation. If
          Dumpster Delivery Rental is chosen, than the following statement is applicable:
        </p>
        <p>
          Base rental price includes delivery and pickup. <strong>Disposal is billed separately at {formatMoney(fee('dump_tonnage_rate'))} per ton</strong>{' '}
          based on actual post-disposal scale weight.
        </p>
        <p>
          Customer authorizes U-Fill Dumpsters LLC to charge the payment method on file for all disposal charges,
          overweight fees ({formatMoney(fee('dumpster_overweight_rate'))} per ton over limit), damages, fines, and dry
          run fees ({formatPercent(fee('dry_run_percentage'))}% of service cost).
        </p>
      </>
    ),
  },
  {
    id: 'equipment',
    title: 'Equipment Care & Usage',
    summary: 'Prohibited materials, loading rules, and weight limits.',
    content: (
      <>
        <p>
          <strong>Weight Limits:</strong> Dumpsters ({formatTons(fee('dumpster_allowed_tons'))} tons), Trailers (
          {formatTons(fee('dump_loader_max_tons'))} tons). Do not exceed the marked Fill Line. Dirt/soil loads must
          not exceed halfway up trailer walls.
        </p>
        <p>
          <strong>Prohibited Materials:</strong> Hazardous materials, paints, solvents, chemicals, asbestos, oils,
          liquids, medical waste, explosives, tires (unless approved), batteries, refrigerators with Freon, and
          contaminated soils are strictly prohibited.
        </p>
        <p>
          Discovery of prohibited items will result in immediate termination of the rental and remediation at the
          Customer&apos;s full expense. Costs for the proper disposal of hazardous materials and any damage to the
          equipment will be assessed. Additionally, daily rental fees will continue to be charged until the equipment is
          returned to service and, if necessary, cleared by the proper authorities.
        </p>
      </>
    ),
  },
];
