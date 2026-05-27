import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import {
  AlertTriangle,
  ClipboardSignature as Signature,
  ArrowLeft,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';

const DEFAULT_FEES = {
  extension_fee: 75,
  dry_run_percentage: 50,
  dumpster_allowed_tons: 2.5,
  dumpster_overweight_rate: 100,
  dump_loader_max_tons: 5,
  base_dump_fee: 150,
  dump_tonnage_rate: 45,
  special_item_fee_min: 20,
  special_item_fee_max: 50,
  cleaning_fee: 20,
  advance_cancel_percentage: 10,
  late_cancel_percentage: 50,
  small_equipment_admin_rate: 15,
  driveway_protection_plan_cost: 15,
  hardware_protection_plan_cost: 15,
  hardware_protection_plan_cap: 500,
};

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}`;
const formatTons = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');

const AgreementText = ({ fees }) => {
  const fee = (key) => fees[key] ?? DEFAULT_FEES[key];

  return (
    <div className="prose prose-sm prose-invert text-blue-200 max-w-none space-y-4">
      <h2 className="text-xl text-center font-bold text-yellow-300">MASTER RENTAL AND SERVICE AGREEMENT</h2>
      <p>
        <strong>IMPORTANT LEGAL NOTICE:</strong> PLEASE READ THIS AGREEMENT IN ITS ENTIRETY BEFORE ACCEPTING. BY
        CHECKING THE ACCEPTANCE BOX, CLICKING "I AGREE," PROVIDING AN ELECTRONIC OR WRITTEN SIGNATURE, OR BY TAKING
        DELIVERY, PLACEMENT, OR PHYSICAL POSSESSION OF ANY COMPANY EQUIPMENT, TRAILERS, BINS, OR ORDERING BULK
        MATERIALS, THE CUSTOMER EXPLICITLY AGREES TO BE FULLY BOUND BY EVERY TERM, FINANCIAL PENALTY, AND LIABILITY
        WAIVER CONTAINED HEREIN.
      </p>
      <p>
        <strong>UNIVERSAL APPLICABILITY NOTICE:</strong> This agreement applies across all services offered by the
        Company. Service-specific clauses apply only where applicable to the equipment, service, add-ons, and booking
        selections made by the Customer.
      </p>

      <h3 className="text-lg text-yellow-300">SECTION 1: DEFINITIONS &amp; UNIVERSAL APPLICABILITY</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>"Company"</strong> refers to U-Fill Dumpsters LLC, a Utah limited liability company. Contact:
          support@u-filldumpsters.com, (801) 810-8832.
        </li>
        <li>
          <strong>"Customer"</strong> refers to the individual, business entity, or representative identified on the
          digital booking, invoice, or signature block.
        </li>
        <li>
          <strong>"Equipment"</strong> means dumpsters, dump-loader trailers, roll-off trailers, dump bins, delivery
          vehicles, mini excavators, mini skid steers, track loaders, attachments, tools, or any supplementary rental
          units provided by the Company.
        </li>
        <li>
          <strong>"Small Equipment"</strong> means wheelbarrows, hand trucks, tools, or other supplementary items
          rented by the Customer.
        </li>
        <li>
          <strong>"Rental Period"</strong> means the period beginning on the delivery date/time (or when the Customer
          takes possession) and ending when the Company retrieves the Equipment, as scheduled or extended in writing.
        </li>
        <li>
          <strong>"Fill Line"</strong> means the manufacturer&apos;s or Company&apos;s marked maximum fill height.
        </li>
        <li>
          <strong>"Dry Run"</strong> means a scheduled delivery or pickup attempt that cannot be completed due to the
          Customer&apos;s fault, obstruction, or access issues.
        </li>
        <li>
          <strong>"Prohibited Materials"</strong> means hazardous materials and other restricted items listed in
          Section 5.
        </li>
        <li>
          <strong>Scope of Applicability</strong>: This Agreement operates on an <strong>"as applicable"</strong>
          basis. If the Customer rents a heavy machine, equipment rules apply. If the Customer rents a trailer or bin,
          dumpster rules apply. If the Customer orders bulk aggregate, material delivery rules apply.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 2: RENTAL PERIOD, LOGISTICS, &amp; SITE ACCESS</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Rental Period &amp; Extensions:</strong> The rental begins on delivery and ends on the scheduled
          pickup. Extensions must be requested at least <strong>24 hours</strong> before the scheduled pickup and are
          subject to operational availability and an applicable extension fee of {formatMoney(fee('extension_fee'))}.
        </li>
        <li>
          <strong>Delivery &amp; Pickup Windows:</strong> Standard delivery and pickup windows will be provided at
          booking. Timed deliveries or after-hours requests may incur additional dynamic fees.
        </li>
        <li>
          <strong>Placement &amp; Access:</strong> The Customer must provide a safe, stable placement site on private
          property unless street/curb placement with required municipal permits has been pre-agreed. The site must be
          clear of overhead obstructions (wires, branches) and structurally able to support the weight of the
          Equipment and delivery vehicles. The Customer is solely responsible for obtaining any permits for
          public/street placement and ensuring compliance with local ordinances.
        </li>
        <li>
          <strong>Stuck Vehicles:</strong> If a Company vehicle or trailer becomes stuck due to unstable ground
          conditions (mud, soft soil, sand, clay, poor drainage) at the Customer&apos;s requested site, the Customer is
          100% responsible for all towing, recovery, and associated costs.
        </li>
        <li>
          <strong>Dry Run Fee:</strong> If the Company cannot complete a delivery or pickup due to the Customer&apos;s
          fault (blocked access, parked vehicles, locked gates, unsafe conditions, overfilled bins, or lack of
          permits), the Customer will be automatically charged a Dry Run fee equal to {formatPercent(fee('dry_run_percentage'))}% of
          the original service cost, plus any additional dynamic towing or retrieval charges incurred by the Company.
        </li>
        <li>
          <strong>Unauthorized Movement:</strong> The Customer shall <strong>NOT</strong> move, tow, relocate, or
          operate trailered Equipment without explicit written authorization from the Company. Any damage resulting from
          unauthorized movement is the Customer&apos;s sole responsibility and will be billed in full.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 3: BASE FEES, OVERWEIGHT CHARGES, &amp; CANCELLATIONS</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Payment &amp; Deposits:</strong> Full payment, including taxes and any applicable security deposits or
          add-on protection fees, is due at booking to secure the reservation unless otherwise agreed in writing.
        </li>
        <li>
          <strong>Dumpster / Trailer Base Rates:</strong> If a Dumpster or Dump Loader Trailer Rental is chosen, the
          base rental price includes one delivery and one pickup. Disposal is billed separately at a rate of{' '}
          {formatMoney(fee('dump_tonnage_rate'))} per ton based on the actual post-disposal certified scale weight.
          Disposal charges are calculated after dump processing and charged to the Customer&apos;s payment method on file.
        </li>
        <li>
          <strong>Overweight &amp; Overage Charges:</strong> Overweight charges for dumpsters are{' '}
          {formatMoney(fee('dumpster_overweight_rate'))} per ton over the allowed limit of{' '}
          {formatTons(fee('dumpster_allowed_tons'))} tons. The Dump Loader Trailer overage rate applies past a limit
          of {formatTons(fee('dump_loader_max_tons'))} tons. The Customer is solely liable for any municipal
          overweight citations or traffic penalties imposed by authorities.
        </li>
        <li>
          <strong>Municipal Dump Fees &amp; Special Item Fees:</strong> The Customer is responsible for municipal dump
          fees at cost: {formatMoney(fee('base_dump_fee'))} plus {formatMoney(fee('dump_tonnage_rate'))} per ton.
          Special-item disposal fees apply to items requiring special handling (including but not limited to:
          mattresses, electronics, TVs, major appliances, or appliances containing refrigerant unless certified
          professional removal documentation is provided). These items are billed at a dynamic range of{' '}
          {formatMoney(fee('special_item_fee_min'))} to {formatMoney(fee('special_item_fee_max'))} per item or actual
          disposal cost.
        </li>
        <li>
          <strong>Cleaning Fee:</strong> If the Equipment is returned or left in an excessively dirty condition
          requiring specialized cleaning, washing, or pressure washing by the Company, an automatic cleaning fee of{' '}
          {formatMoney(fee('cleaning_fee'))} will apply.
        </li>
        <li>
          <strong>Cancellation &amp; Refunds:</strong> Cancellations more than 24 hours before scheduled delivery: A
          cancellation fee of {formatPercent(fee('advance_cancel_percentage'))}% of the order total is retained; the
          remaining balance is refunded. Cancellations 24 hours or less before scheduled delivery: Up to{' '}
          {formatPercent(fee('late_cancel_percentage'))}% of the order total is charged, and a{' '}
          {formatPercent(fee('advance_cancel_percentage'))}% cancellation fee of the order total is retained. No-shows
          or refusal of equipment at delivery result in full rental charges. Refunds are processed within 1 to 2
          business days and typically reflect in accounts within 5 to 10 business days. In rare cases, banking
          institutions may take up to 30 days. The Customer may request their Acquirer Reference Number (ARN) through
          the customer portal, which will be provided within 1 to 2 business days upon request.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 4: WEIGHT LIMITS, LOADING, &amp; SPECIAL SERVICES</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Weight &amp; Moisture:</strong> 16-yard dumpsters are rated for up to {formatTons(fee('dumpster_allowed_tons'))}{' '}
          tons. Dump Loader Trailers have a max capacity limit of {formatTons(fee('dump_loader_max_tons'))} tons.
          High-density materials like dirt, soil, concrete, or rock loads must <strong>not exceed halfway up</strong>{' '}
          the trailer/bin walls. The Customer is responsible for the total scale weight regardless of rain, water,
          snow, ice, or other moisture accumulated in the open unit during the Rental Period. Overweight loads are
          subject to immediate additional fees and the refusal of pickup until corrected by the Customer.
        </li>
        <li>
          <strong>Loading &amp; Fill Line:</strong> Do not exceed the marked Fill Line. Do not place materials that may
          fall, spill, or blow out during highway transport. Do not obstruct the Company&apos;s mechanical access to lift
          points or trailer hooks.
        </li>
        <li>
          <strong>Aggregate &amp; Material Delivery:</strong> For deliveries of bulk gravel, rock, mulch, sand, and
          aggregate materials, the Company will dump materials at the specific location requested by the Customer. Once
          material is dumped, the Company is completely exempt from moving, spreading, or leveling it. Materials are
          natural products; the Company does not guarantee exact color, texture, or gradation matches. All sales of
          aggregate are final once dumped.
        </li>
        <li>
          <strong>Small Equipment Rental (Wheelbarrows, Hand Trucks, Tools):</strong> The Customer is entirely
          responsible for the condition, theft, loss, or destruction of Small Equipment. Broken or missing items will
          be charged to the payment method on file at full retail replacement cost plus an administrative fee of{' '}
          {formatPercent(fee('small_equipment_admin_rate'))}%. The Customer assumes all risk of bodily injury arising
          from the operation of Small Equipment.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 5: PROHIBITED MATERIALS &amp; ENVIRONMENTAL LAW</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Prohibited Materials (Enhanced):</strong> The Customer shall <strong>NOT</strong> place hazardous
          materials into the Equipment, including but not limited to: paints, solvents, chemical compounds, asbestos,
          motor oils, fuels, liquids, pesticides, medical or biological waste, radioactive materials, explosives,
          compressed gas cylinders, PCB-containing items, tires (unless explicitly pre-approved in writing), batteries,
          or appliances containing refrigerant/Freon (unless professional, documented refrigerant evacuation is
          provided).
        </li>
        <li>
          <strong>Discovery &amp; Remediation:</strong> Discovery of prohibited items will result in the immediate
          termination of the rental and comprehensive remediation at the Customer&apos;s full expense. Costs for
          environmental cleanup, proper disposal of hazardous waste, and any physical damage to the equipment will be
          assessed and billed. Daily rental fees will continue to accumulate against the Customer&apos;s account until the
          Equipment is thoroughly cleared by proper authorities and returned to active service.
        </li>
        <li>
          <strong>Disposal Laws &amp; Inspections:</strong> The Customer warrants compliance with all federal, state,
          and local environmental laws. The Company reserves the right to inspect contents, reject loads, or remove
          prohibited items at any time, or require the Customer to manually remove offending materials prior to pickup.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 6: DO-IT-YOURSELF (DIY) HEAVY EQUIPMENT OPERATIONAL CLAUSES</h3>
      <p><em>(Applicable whenever renting Mini Excavators, Mini Skid Steers, Track Loaders, or Heavy Machinery Attachments)</em></p>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Operator Competency Affirmation:</strong> The Customer acknowledges they are renting commercial heavy
          equipment for "Do It Yourself" (DIY) purposes. The Customer explicitly affirms that the intended operator
          possesses the physical and mental capability, operational knowledge, and technical skill required to safely
          operate the machinery. The Customer certifies they have inspected the machine upon delivery/pickup and find
          it safe, undamaged, and fully operable.
        </li>
        <li>
          <strong>Prohibited Machine Uses:</strong> The Customer shall not allow unauthorized, untrained, or minor
          operators to handle the machinery. Operation under the influence of alcohol, drugs, prescription medication,
          or while fatigued is strictly prohibited. The Customer shall not modify, alter, or overload the machinery
          beyond manufacturer specifications.
        </li>
        <li>
          <strong>Heavy Equipment Subsurface Damage:</strong> The Customer assumes 100% sole responsibility for
          identifying, locating, and clearly marking all underground utilities, septic systems, irrigation lines, power
          lines, gas lines, and water pipes before operating excavation or loading machinery. The Company is completely
          exempt from liability for any damage caused to subterranean assets, utilities, or structures during the
          rental.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 7: PROPERTY DAMAGE, COMPLIANCE, &amp; TOWING SAFETY LAWS</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Subsurface &amp; Property Damage Disclaimer:</strong> The Company is not liable for damage to
          undisclosed or inadequately protected subsurface structures. The Customer explicitly acknowledges that
          delivery vehicles, heavy roll-off trailers, dump bins, skid steers, and excavators are exceptionally heavy.
          The Company is not liable for scuffing, cracking, indentation, marking, or structural surface damage to
          asphalt, concrete driveways, pavers, lawns, or landscaping resulting from Equipment weight or material
          placement.
        </li>
        <li>
          <strong>Optional Driveway Protection Plan:</strong> An optional Driveway Protection Plan is available for a
          fee of {formatMoney(fee('driveway_protection_plan_cost'))}. If declined, the Customer accepts full
          responsibility for potential property damage as described above.
        </li>
        <li>
          <strong>Towing Safety &amp; Transport Compliance:</strong> The Customer assumes 100% compliance responsibility
          for any Equipment they tow or transport. The Customer warrants they have inspected and verified the presence
          and proper function of all required safety items, including but not limited to: high-tensile safety chains,
          proper breakaway switches, secure hitch connections, and compliance towing towels/pads to secure components.
          The Customer warrants that they fully understand how to safely utilize the Equipment and agree to strictly
          follow all local, state, and federal transport laws, legal lighting configurations, wiring setups, and speed
          constraints. The Company accepts zero liability for roadside citations, accidents, or loose cargo during
          transport.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 8: STRICT EQUIPMENT RETURN CONDITION &amp; LOSS OF USE</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Exact Condition Clause:</strong> The Customer explicitly agrees to return all Equipment, trailers,
          machinery, and bins in the exact same condition it was in at the time of rental commencement, excluding only
          expected, standard wear and tear as defined by manufacturer baseline guidelines.
        </li>
        <li>
          <strong>Damage Assessment:</strong> Any structural warping, bending, deep gouging, component loss, mechanical
          failure, or dynamic degradation discovered upon return shall be deemed direct Customer damage and will be
          billed at full parts and field labor repair rates.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 9: INTEGRATED HARDWARE PROTECTION PLAN (HPP) &amp; 100% LIABILITY</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>100% Customer Liability Default:</strong> The Customer is default 100% financially responsible and
          personally liable for any and all damage, destruction, breakdown, loss, or theft of the Equipment during the
          Rental Period.
        </li>
        <li>
          <strong>Optional HPP Enrollment:</strong> For an optional baseline fee of{' '}
          {formatMoney(fee('hardware_protection_plan_cost'))}, the Customer may enroll in our Hardware Protection Plan
          for eligible premium Sure-Trac equipment.
        </li>
        <li>
          <strong>Scope of Limited Coverage:</strong> If elected and paid for at booking, this protection plan reduces
          the Customer&apos;s out-of-pocket exposure by providing a credit of up to{' '}
          {formatMoney(fee('hardware_protection_plan_cap'))} toward the actual cost of repairs or parts replacement
          strictly for accidental hardware damage to the following systems: Auto-Tarping Systems and mechanical
          linkages, Wireless Remote Systems and internal electrical receivers, Hydraulic Lift Systems, pumps, rams,
          cylinders, and fluid lines, Winch assemblies and integrated trailer safety lighting.
        </li>
        <li>
          <strong>Strict Exclusions &amp; Customer Responsibility for Balance:</strong> The Customer remains 100%
          financially responsible for any repair costs exceeding the {formatMoney(fee('hardware_protection_plan_cap'))}{' '}
          credit cap, and the HPP provides ZERO COVERAGE for the following scenarios: tire damage, overloading and
          improper operation, gross negligence, unauthorized operators, intentional damage, cosmetic and structural bin
          damage, and property exclusions outside the roll-off trailer.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 10: MANDATORY CREDIT CARD AUTHORIZATION &amp; INSUFFICIENT FUNDS</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Absolute Card-on-File Authorization:</strong> The Customer explicitly, irrevocably authorizes the
          Company to automatically charge the credit card or payment method on file for any and all rental balances,
          dump disposal fees, overweight fines, cleaning fees, missing attachments, physical damage repairs, equipment
          replacement costs, or stolen asset values.
        </li>
        <li>
          <strong>Insufficient Funds Contingency:</strong> If the credit card on file declines or has insufficient
          funds to cover the total amount of fees, damages, or charges due under this Agreement, the Customer remains
          fully liable and agrees to pay the outstanding balance immediately upon demand.
        </li>
        <li>
          <strong>Collections, Loss of Use, and Administrative Recovery Fees:</strong> If the Company must take
          administrative or legal action to recover unpaid balances, repair costs, or replacement values, the Customer
          agrees to pay all collection costs, court fees, filing penalties, and reasonable attorneys&apos; fees, a strict
          "Loss of Use" fee calculated at the standard daily rental rate for each day the equipment is out of service,
          and all administrative expenses including management time required to resolve collection and repair processing.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 11: INDEMNIFICATION, LIABILITY WAIVER, &amp; LEGAL FEES EXEMPTION</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Assumption of Risk:</strong> The Customer explicitly acknowledges that operating heavy mechanical
          equipment, managing bulk trailers, and placing large dump bins involves inherent dangers, including risk of
          severe property damage, serious bodily injury, or death. The Customer voluntarily accepts all risks
          associated with the possession, transport, and operation of the Equipment.
        </li>
        <li>
          <strong>Waiver of Liability:</strong> Except to the extent caused by the Company&apos;s gross negligence or
          willful misconduct, the Customer hereby releases, waives, and forever discharges the Company, its owners,
          officers, family representatives, and employees from any and all liability, claims, losses, or lawsuits
          arising out of the operation, transportation, failure, structural placement, malfunction, or presence of the
          Equipment or Services.
        </li>
        <li>
          <strong>Company Legal Fees Exemption:</strong> The Company shall NEVER be liable for any legal fees, defense
          costs, or attorney expenses incurred by the Customer or any third party. The Customer accepts full financial
          obligation for any and all legal entanglements arising out of their use of the Equipment.
        </li>
        <li>
          <strong>Indemnification:</strong> To the fullest extent permitted by law, the Customer shall indemnify,
          defend, and hold harmless the Company, its owners, officers, agents, and employees from all claims,
          liabilities, losses, damages, costs, and expenses (including reasonable attorneys&apos; fees and court costs)
          arising out of the Customer&apos;s use, possession, placement, operation, loading, transport, or maintenance of
          the Equipment or Services.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 12: EXPRESS CONSENT FOR COMMUNICATIONS &amp; PRIVACY PROTECTION</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Express Communication Consent:</strong> By providing a telephone number and email address during
          checkout, booking, or sign-up, the Customer explicitly consents and grants express authorization to the
          Company to contact them via email, telephone voice call, pre-recorded voice message, and short message
          service (SMS/text messaging).
        </li>
        <li>
          <strong>Operational &amp; Marketing Scope:</strong> Authorized communications include, but are not limited to:
          essential operational notifications, arrival tracking, pickup updates, billing notices, receipt delivery,
          marketing materials, special coupons, holiday discounts, and company referral programs. The Customer
          acknowledges that text messages and calls may be transmitted via automated telephone dialing systems or
          automated email platforms. Consent to receive marketing text messages or emails is not a condition of
          purchase or rental. Standard message and data rates may apply. The Customer may opt-out of marketing
          communications at any time by replying "STOP" to text messages or clicking "Unsubscribe" in emails.
        </li>
        <li>
          <strong>Strict Third-Party Privacy Protection:</strong> The Company strictly values the Customer&apos;s privacy.
          The Company warrants that it does not sell, rent, lease, trade, or distribute the Customer&apos;s personal data,
          contact information, phone numbers, or email addresses to any third-party marketing companies, brokers, or
          external entities. All information collected is utilized exclusively for the internal business operations,
          customer service, and direct marketing initiatives of the Company.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 13: TERMINATION, LIENS, &amp; DISPUTES</h3>
      <ul className="list-disc list-inside space-y-2">
        <li>
          <strong>Termination:</strong> The Company may terminate this Agreement and immediately retrieve the Equipment
          without notice if the Customer breaches any material term, creates a hazardous condition, or uses the
          Equipment for unlawful purposes. Termination does not relieve the Customer of payment obligations.
        </li>
        <li>
          <strong>Utah Mechanic&apos;s Lien Rights:</strong> Pursuant to Utah state law, the Company explicitly reserves the
          right to file a mechanic&apos;s lien against the Customer&apos;s real property for any unpaid services or rentals that
          improve, clear, or modify the property (including but not limited to aggregate delivery, construction debris
          removal, or heavy equipment rental).
        </li>
        <li>
          <strong>Dispute Resolution &amp; Governing Law:</strong> This Agreement shall be governed, interpreted, and
          enforced strictly in accordance with the laws of the State of Utah. The Customer and Company consent to the
          exclusive jurisdiction and venue of the state and federal courts located in Utah County, Utah. Alternatively,
          the parties may elect binding arbitration under the American Arbitration Association (AAA) rules, to be held
          in Utah County, Utah, if both parties agree in writing.
        </li>
        <li>
          <strong>Severability &amp; Miscellaneous:</strong> If any provision of this contract is deemed invalid or
          unenforceable by a court of competent jurisdiction, the remaining terms and provisions shall continue in full
          force and effect. Failure to enforce a provision does not waive future enforcement. This constitutes the
          entire agreement between the parties.
        </li>
      </ul>

      <h3 className="text-lg text-yellow-300">SECTION 14: ELECTRONIC SIGNATURE &amp; ACKNOWLEDGMENT</h3>
      <p>
        The Customer&apos;s electronic acceptance, checking the "I Agree" box on the booking screen, or providing a
        written/digital signature constitutes a legally binding signature. The Customer affirms they are at least 18
        years of age and possess full legal authority to enter into this Agreement on behalf of themselves or the
        entity they represent.
      </p>

      <h3 className="text-lg text-yellow-300">SECTION 15: LEGAL COMPLIANCE SAVINGS CLAUSE</h3>
      <p>
        Where required by applicable law, any non-waivable consumer rights remain preserved. If any section of this
        Agreement conflicts with mandatory law, that section is interpreted only to the minimum extent required for
        legal compliance, and all remaining provisions continue in full force and effect.
      </p>
    </div>
  );
};

export const ComprehensiveAgreement = ({ onBack, onAccept, bookingData, isProcessing }) => {
  const [signature, setSignature] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToSummary, setAgreedToSummary] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [error, setError] = useState('');
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [feeRows, setFeeRows] = useState([]);

  const agreementViewportRef = useRef(null);

  const expectedName = `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim();

  useEffect(() => {
    let isMounted = true;

    const loadFees = async () => {
      const { data, error: feesError } = await supabase
        .from('charges_and_fees')
        .select('fee_key, fee_name, fee_description, fee_value, is_percentage')
        .order('fee_name', { ascending: true });

      if (feesError || !data) return;

      if (isMounted) {
        setFeeRows(data);
        const mapped = data.reduce(
          (acc, row) => ({ ...acc, [row.fee_key]: Number(row.fee_value) }),
          {},
        );
        setFees((prev) => ({ ...prev, ...mapped }));
      }
    };

    loadFees();
    return () => {
      isMounted = false;
    };
  }, []);

  const evaluateScrollCompletion = (element) => {
    if (!element) return;
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
    const noScrollNeeded = element.scrollHeight <= element.clientHeight + 2;
    if (atBottom || noScrollNeeded) {
      setHasScrolledToBottom(true);
    }
  };

  useEffect(() => {
    const element = agreementViewportRef.current;
    if (!element) return undefined;

    const onScroll = () => evaluateScrollCompletion(element);
    element.addEventListener('scroll', onScroll);

    // Initial pass in case content already fits
    evaluateScrollCompletion(element);

    return () => {
      element.removeEventListener('scroll', onScroll);
    };
  }, []);

  const isButtonDisabled = useMemo(
    () =>
      !signature.trim() ||
      !agreedToTerms ||
      !hasScrolledToBottom ||
      !agreedToSummary ||
      isProcessing,
    [signature, agreedToTerms, hasScrolledToBottom, agreedToSummary, isProcessing],
  );

  const handleSubmit = () => {
    const trimmedSignature = signature.trim();

    if (trimmedSignature.toLowerCase() !== expectedName.toLowerCase()) {
      setError(`Signature must exactly match the name on the booking: ${expectedName}`);
      return;
    }

    if (!agreedToTerms) {
      setError('You must check the box to agree to the entire Rental Agreement.');
      return;
    }

    if (!hasScrolledToBottom || !agreedToSummary) {
      setError(
        'Please scroll through the full agreement and acknowledge the Important Rental Terms Summary.',
      );
      return;
    }

    const agreementFeeSnapshot = (feeRows || []).map((row) => ({
      fee_key: row.fee_key,
      fee_name: row.fee_name,
      fee_description: row.fee_description || '',
      fee_value: Number(row.fee_value || 0),
      is_percentage: Boolean(row.is_percentage),
      captured_at: new Date().toISOString(),
      source: 'agreement_step6_acceptance',
    }));

    setError('');
    onAccept({ agreementFeeSnapshot });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-6">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
            <ArrowLeft />
          </Button>
          <h2 className="text-3xl font-bold text-white">Rental Agreement &amp; Signature</h2>
        </div>

        <p className="text-blue-200 mb-4">
          Please read the following agreement carefully. Your electronic signature is required to proceed.
        </p>

        <ScrollArea
          className="h-[40vh] w-full rounded-md border border-white/30 bg-black/20 p-4 mb-6"
          viewportRef={agreementViewportRef}
        >
          <AgreementText fees={fees} />
        </ScrollArea>

        <div className="space-y-4">
          <div>
            <Label htmlFor="signature" className="text-lg font-semibold text-white flex items-center mb-2">
              <Signature className="mr-2 h-5 w-5 text-yellow-400" />
              E-Signature
            </Label>
            <p className="text-sm text-blue-200 mb-2">
              Please type your full name as it appears on the booking:{' '}
              <strong className="text-yellow-300">{expectedName}</strong>
            </p>
            <Input
              id="signature"
              type="text"
              placeholder="Type your full name here"
              value={signature}
              onChange={(e) => {
                setSignature(e.target.value);
                if (error) setError('');
              }}
              className="bg-white/10 border-white/30 text-white placeholder-blue-200 focus:ring-yellow-400"
            />
          </div>

          <div className="flex items-center space-x-3 pt-2">
            <Checkbox
              id="terms-agree"
              checked={agreedToTerms}
              onCheckedChange={(checked) => {
                setAgreedToTerms(Boolean(checked));
                if (error) setError('');
              }}
              className="border-white/50 data-[state=checked]:bg-yellow-400 h-6 w-6"
            />
            <Label htmlFor="terms-agree" className="text-sm text-white cursor-pointer select-none">
              I have read, understood, and agree to be bound by the entire Rental Agreement.
            </Label>
          </div>

          <div
            className="rental-terms-summary-container"
            style={{
              marginTop: '30px',
              padding: '20px',
              border: '2px solid #ff9900',
              backgroundColor: '#fff9f0',
              borderRadius: '8px',
            }}
          >
            <h3 style={{ color: '#cc3300', marginTop: 0, fontWeight: 'bold' }}>
              ⚠️ IMPORTANT RENTAL TERMS SUMMARY
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#333' }}>
              By checking this box and completing your booking, you explicitly authorize{' '}
              <strong>U-Fill Dumpsters LLC</strong> to automatically charge your payment method on file for all rental
              fees, disposal overages, cleanings, and any equipment damage, loss, or theft. You acknowledge that you
              are default <strong>100% financially liable</strong> for all equipment recovery costs, court fees,
              administrative labor, and "Loss of Use" penalties if your payment method is declined or if equipment is
              returned damaged, overfilled, or violating safety transport laws. You certify that you are at least 18
              years of age, fully competent to operate or transport the rented equipment, and agree to the
              comprehensive terms of our <strong>Master Rental &amp; Service Agreement</strong>. If any optional
              insurance, protection, or peace-of-mind coverage is purchased, the Customer remains fully responsible for
              all amounts, losses, liabilities, and damages that exceed the purchased coverage limits, exclusions, or
              credit caps.
            </p>

            <div className="checkbox-wrapper" style={{ marginTop: '15px', display: 'flex', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                id="requireSummaryScrollCheck"
                disabled={!hasScrolledToBottom}
                checked={agreedToSummary}
                onChange={(e) => {
                  setAgreedToSummary(e.target.checked);
                  if (error) setError('');
                }}
                style={{ marginRight: '10px', transform: 'scale(1.2)', marginTop: '3px' }}
              />
              <label
                htmlFor="requireSummaryScrollCheck"
                style={{ fontSize: '13px', color: '#555', fontWeight: 'bold', cursor: 'pointer' }}
              >
                I have fully scrolled, read, and explicitly agree to the Important Rental Terms Summary and the
                complete Master Agreement terms.
              </label>
            </div>
            {!hasScrolledToBottom && (
              <p className="text-xs mt-2" style={{ color: '#8a4b00' }}>
                Scroll to the bottom of the Master Agreement to enable this checkbox.
              </p>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center text-red-400 text-sm bg-red-900/50 p-3 rounded-md border border-red-500/30"
            >
              <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
              {error}
            </motion.div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isButtonDisabled}
            className={`w-full py-6 text-xl font-bold transition-all duration-300 transform active:scale-[0.98] ${
              isButtonDisabled
                ? 'bg-white/10 text-white/30 cursor-not-allowed border border-white/10'
                : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white shadow-xl shadow-green-900/40 border border-green-400/30'
            }`}
          >
            {isProcessing ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : null}
            {isProcessing ? (
              'Processing...'
            ) : (
              <div className="flex items-center justify-center">
                Agree &amp; Continue <ArrowRight className="ml-2 h-6 w-6" />
              </div>
            )}
          </Button>
          <UiControlGuide
            stepTitle="Rental Agreement"
            entries={getBookingGuideEntries('agreement')}
            className="mt-3 flex justify-end"
          />
        </div>
      </div>
    </motion.div>
  );
};

