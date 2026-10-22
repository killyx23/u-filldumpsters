import React from 'react';
import { formatAdminMoney, formatAdminPercent, UNAVAILABLE_FEE_TEXT } from '@/utils/chargesAndFeesConfig';
import { SmsDisclosure } from '@/components/SmsOptInFields';

const percentLabel = (fee, key) => {
  const formatted = formatAdminPercent(fee(key));
  return formatted === UNAVAILABLE_FEE_TEXT ? formatted : `${formatted}%`;
};

const publishedMoney = (fee, key, label) => {
  const value = fee(key);
  if (value == null || value === '' || !Number.isFinite(Number(value))) {
    return `the ${label} then in effect`;
  }
  return formatAdminMoney(value);
};

export const buildTermsSections = (fee, options = {}) => {
  const disclosureClassName = options.disclosureClassName || 'text-sm text-gray-300 leading-relaxed';
  return [
  {
    id: 'email',
    title: 'Email & Text Message Communication',
    summary: 'Email is required for booking updates. Text messages use separate optional checkboxes and are not required.',
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
          Text messages are optional and are not part of email consent. Next to the phone number there are two separate
          checkboxes, one for transactional order texts and one for marketing texts. Neither box is required or
          pre-checked. A third checkbox is for agreeing to the Terms and Conditions and the Privacy Policy.
        </p>
        <SmsDisclosure className={disclosureClassName} />
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Liability & Damage Responsibility',
    summary: 'AS-IS inspection, ordinary-negligence waiver, property-damage release, and indemnification.',
    content: (
      <>
        <p>
          <strong>1. Limitation of liability and assumption of risk.</strong>
        </p>
        <p>
          <strong>&quot;AS-IS&quot; condition and Customer inspection.</strong> By taking possession of the equipment,
          the Customer agrees they have fully inspected the rented items, including but not limited to heavy machinery,
          dumpsters, dump trailers, tires, brakes, hitch mechanisms, electrical connections, hubs, and wheel bearings.
          The Customer accepts the equipment completely &quot;AS-IS&quot; and acknowledges it is in good, safe, and
          operable condition.
        </p>
        <p>
          <strong>Towing and roadside risks.</strong> The Customer assumes full responsibility for safely coupling any
          trailer to a properly rated tow vehicle. The Customer acknowledges that mechanical components, including
          tires, axles, and wheel bearings, can fail unexpectedly due to overloading, uneven weight distribution, or
          road conditions. The Company is not liable for any roadside breakdowns, highway accidents, towing delays, or
          tire failures once the equipment leaves the Company&apos;s possession. The Customer is responsible for
          monitoring the equipment during transport and operation.
        </p>
        <p>
          <strong>Waiver of ordinary negligence.</strong> To the maximum extent permitted by Utah law, the Customer
          explicitly releases, waives, and discharges the Company, its members, and employees from any and all
          liability, claims, or lawsuits for personal injury, death, or property damage resulting from the ordinary
          negligence of the Company regarding the inspection, maintenance, selection, or delivery of the equipment.
        </p>
        <p>
          <strong>Indemnification.</strong> The Customer agrees to defend, indemnify, and hold harmless the Company from
          any and all third-party claims, lawsuits, or financial losses, including attorney fees, arising directly or
          indirectly out of the Customer&apos;s possession, towing, operation, or placement of the equipment.
        </p>
        <p>
          <strong>2. Dumpster and trailer property damage waiver.</strong>
        </p>
        <p>
          <strong>Placement instructions.</strong> The Customer assumes all responsibility for designating the location
          where the dumpster or dump trailer is placed. The Customer warrants that any location designated for placement
          is structurally capable of supporting the weight of the equipment and the delivery and haul-away trucks.
        </p>
        <p>
          <strong>Absolute release for property damage.</strong> The Customer acknowledges that heavy equipment,
          dumpsters, and dump trailers can cause severe damage to surfaces. The Customer explicitly releases the Company
          from any and all liability for damage to driveways, asphalt, concrete, sidewalks, lawns, landscaping,
          sprinkler systems, fences, or underground utilities, including water, gas, power, or septic lines, resulting
          from the weight, placement, delivery, dropping, or removal of the equipment.
        </p>
        <p>
          <strong>Surface protection.</strong> If the Customer is concerned about driveway damage, it is the
          Customer&apos;s sole responsibility to provide and lay down protective plywood or boards prior to delivery. The
          Company does not guarantee that protective materials will prevent damage and remains completely released from
          liability.
        </p>
      </>
    ),
  },
  {
    id: 'general',
    title: 'General Terms & Cancellation Policy',
    summary: 'Cancellation and rescheduling fees, refunds, and general rental conditions.',
    content: (
      <>
        <p>
          <strong>Cancellations more than 24 hours before scheduled delivery:</strong>{' '}
          {percentLabel(fee, 'advance_cancel_percentage')} cancellation fee of the order total retained; balance
          refunded.
        </p>
        <p>
          <strong>Cancellations 24 hours or less before scheduled delivery:</strong> Up to{' '}
          {percentLabel(fee, 'late_cancel_percentage')} of the order total charged, plus a{' '}
          {percentLabel(fee, 'advance_cancel_percentage')} cancellation fee of the order total retained.
        </p>
        <p>
          <strong>Rescheduling more than 24 hours before the appointment:</strong> A rescheduling fee of{' '}
          {percentLabel(fee, 'advance_reschedule_percentage')} of the original booking total may apply.
        </p>
        <p>
          <strong>Rescheduling 24 hours or less before the appointment:</strong> A rescheduling fee of{' '}
          {percentLabel(fee, 'late_reschedule_percentage')} of the original booking total may apply. Rescheduling
          fees are substantially lower than cancelling when you only need a different date, because it reduces loss of
          business compared with a full cancellation.
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
          Base rental price includes delivery and pickup. <strong>Disposal is billed separately at {formatAdminMoney(fee('dump_tonnage_rate'))} per ton</strong>{' '}
          based on actual post-disposal scale weight.
        </p>
        <p>
          Customer authorizes U-Fill Dumpsters LLC to charge the payment method on file for all disposal charges,
          overweight fees ({formatAdminMoney(fee('dumpster_overweight_rate'))} per ton over limit), damages, fines, and dry
          run fees ({percentLabel(fee, 'dry_run_percentage')} of service cost).
        </p>
      </>
    ),
  },
  {
    id: 'equipment',
    title: 'Equipment Care & Usage',
    summary: 'Weight limits, prohibited materials, theft, and tire responsibility.',
    content: (
      <>
        <p>
          <strong>3. Weight restrictions and overload fees.</strong>
        </p>
        <p>
          <strong>Maximum weight allowance.</strong> The maximum allowable cargo weight depends on the rental type
          selected during checkout. If the Customer tows or hauls the equipment, the absolute maximum cargo weight is 5
          tons (10,000 lbs). If the Company delivers and hauls the load to the dump (valet service), the absolute
          maximum cargo weight is 2.5 tons (5,000 lbs).
        </p>
        <p>
          <strong>Heavy material height restrictions.</strong> Dirt, rock, sand, asphalt, concrete, brick, tile, sod,
          and river rock are extremely dense. They may be loaded only in the rental types that allow them, and only
          within the weight limits in this section. Heavy materials in Customer-towed equipment (5-ton limit) must never
          fill the trailer more than halfway (50%) full. Heavy materials in Company-delivered equipment (2.5-ton limit)
          must never fill the dumpster or trailer more than one-fourth (25%) full. Do not exceed the marked fill line.
        </p>
        <p>
          <strong>Overload penalties and damages.</strong> If the equipment is overloaded beyond those limits, or filled
          past the heavy-material height restrictions, the Customer agrees to pay an immediate Overload Fee of{' '}
          {publishedMoney(fee, 'overload_fee', 'Overload Fee')}, plus any additional dump fees, fines, or citations
          issued by state or DOT authorities. The Customer is 100% financially responsible for any mechanical damage
          caused by overloading, including bent axles, suspension damage, blown tires, or failed wheel bearings. The Company may refuse to
          transport an overloaded unit until the Customer removes the excess weight at the Customer&apos;s own expense.
        </p>
        <p>
          <strong>4. Hazardous materials and prohibited items.</strong>
        </p>
        <p>
          <strong>Prohibited materials.</strong> To protect the equipment, ensure safety, and comply with landfill
          regulations, the Customer shall not place the banned materials below into a dumpster or trailer.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Hazardous materials, chemicals, and liquids.</strong> Wet paint, paint thinners, lacquers, stains,
            varnishes, wood preservatives, and stripping chemicals. Dry, completely hardened paint in cans with the lids
            off is usually acceptable. Automotive fluids, including motor oil, transmission fluid, brake fluid, power
            steering fluid, engine coolant and antifreeze, gasoline, diesel, and grease. Flammables and explosives,
            including propane tanks whether empty or full, oxygen cylinders, aerosol cans, fireworks, ammunition,
            explosives, fuel tanks, and other compressed gas cylinders. Industrial cleaners, pool chemicals, pesticides,
            herbicides, fertilizers, poisons, acids, and contaminated soils. Radioactive materials.
          </li>
          <li>
            <strong>Refrigerant appliances.</strong> Refrigerators, freezers, air conditioners, water coolers,
            dehumidifiers, and any other appliance containing cooling refrigerant, unless professional, documented
            refrigerant evacuation is provided.
          </li>
          <li>
            <strong>Electronics and e-waste.</strong> Computer monitors, laptops, cell phones, printers, DVD players,
            VCRs, and gaming consoles. Televisions are not in this ban; they are covered below.
          </li>
          <li>
            <strong>Batteries.</strong> Car batteries, including lead-acid batteries, lithium-ion batteries, motorcycle
            batteries, and large industrial batteries.
          </li>
          <li>
            <strong>Lighting.</strong> Fluorescent light tubes, light ballasts, and mercury-containing switches.
          </li>
          <li>
            <strong>Tires.</strong> Whole automotive, truck, trailer, and heavy-equipment tires.
          </li>
          <li>
            <strong>Asbestos.</strong> Insulation, siding, ceiling tiles, fireproofing, and any other material
            containing asbestos.
          </li>
          <li>
            <strong>Medical and biohazardous waste.</strong> Infectious waste, syringes and needles, medical garments,
            and animal carcasses.
          </li>
        </ul>
        <p>
          <strong>Mattresses, box springs, and televisions.</strong> Mattresses and box springs may be disposed of
          through the Company, but they cannot be placed in the dumpster or trailer under any circumstances. They are
          hauled in a truck bed and charged the special-item disposal fee then in effect, from{' '}
          {publishedMoney(fee, 'special_item_fee_min', 'minimum special-item fee')} to{' '}
          {publishedMoney(fee, 'special_item_fee_max', 'maximum special-item fee')} per item or the actual disposal cost.
          The Customer must bring them to the curb for pickup. A mattress or box spring found inside the dumpster or
          trailer is a prohibited load and is also subject to the clean-up charges below. Televisions may be accepted
          only when that separate fee is paid for each television. The same special-item fee applies to major appliances
          that do not contain refrigerant.
        </p>
        <p>
          <strong>Clean-up and environmental liability.</strong> If prohibited or hazardous items are found, the
          Customer will be charged an Environmental Clean-up Fee of{' '}
          {publishedMoney(fee, 'environmental_cleanup_fee', 'Environmental Clean-up Fee')}, plus the actual cost of
          professional hazardous disposal, landfill penalties, sorting fines, and any physical damage to the equipment.
          The Customer assumes 100% financial and legal liability for any environmental EPA violations or state or local
          fines resulting from dumping prohibited materials. Daily rental fees continue until the equipment is returned
          to service and, if necessary, cleared by the proper authorities.
        </p>
        <p>
          <strong>5. Theft, damage, and tire maintenance.</strong>
        </p>
        <p>
          <strong>Theft and complete loss.</strong> If the equipment is stolen, lost, or destroyed during the rental
          period, the Customer agrees to pay the Company the full replacement value of the equipment, plus any lost
          rental revenue. The Customer must file a report with local law enforcement and provide a copy to the Company
          within 24 hours of discovery.
        </p>
        <p>
          <strong>Equipment security.</strong> The Customer agrees to keep the equipment secured at all times when not
          in use. For towable trailers, the Customer must use a coupler lock, wheel boot, or park the trailer in a
          locked, secure enclosure.
        </p>
        <p>
          <strong>Tire damage and flat tires.</strong> The Customer is 100% responsible for all tire damage during the
          rental period, including flats, punctures, blowouts, and sidewall damage. If a tire is punctured by debris or
          a stray nail on a job site or driveway while in the Customer&apos;s possession, the Customer is responsible for
          the repair or replacement cost with a matching tire of equal quality.
        </p>
        <p>
          <strong>Prohibited field repairs.</strong> The Customer shall not attempt any major mechanical or structural
          repairs, such as adjusting wheel bearings, replacing axles, or welding, without the Company&apos;s express
          written consent.
        </p>
      </>
    ),
  },
  ];
};
