import React from 'react';
import { Link } from 'react-router-dom';
import { formatAdminMoney } from '@/utils/chargesAndFeesConfig';

export const HPP_TERMS_PATH = '/hardware-protection-plan';

/**
 * Full optional Hardware Protection Plan terms. Dollar amounts come from admin
 * charges and fees, and the enrollment fee uses the live protection-plan price.
 */
export function HardwareProtectionPlanTerms({ fee, linkClassName = 'text-yellow-300 underline hover:text-yellow-200' }) {
  const money = (key) => formatAdminMoney(fee(key));
  const enrollment = money('hardware_protection_plan_cost');
  const credit = money('hardware_protection_plan_cap');
  const remoteFee = money('hpp_missing_remote_fee');
  const winchFee = money('hpp_missing_winch_controller_fee');
  const lightingFee = money('hpp_missing_lighting_fixture_fee');
  const hoseFee = money('hpp_missing_hydraulic_hose_fee');
  const tarpFee = money('hpp_missing_tarp_assembly_fee');

  return (
    <div className="space-y-4" id="hardware-protection-plan-terms">
      <p>
        A standalone copy of these terms can be opened at any time:{' '}
        <Link to={HPP_TERMS_PATH} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          Hardware Protection Plan
        </Link>
        .
      </p>

      <h4 className="text-base font-bold text-white">9.1 Option and Consideration</h4>
      <p>
        Subject to the terms, exclusions, and conditions set forth herein, the Customer may elect to enroll eligible
        premium Sure-Trac equipment in the Company&apos;s optional Hardware Protection Plan (&quot;HPP&quot;). Enrollment
        requires the Customer to affirmatively elect coverage and pay a non-refundable baseline enrollment fee of{' '}
        {enrollment} (the &quot;HPP Fee&quot;) concurrently with, and at the exact time of, the initial booking and
        execution of the applicable Rental or Lease Order. Failure to pay the HPP Fee at the time of booking shall
        render any subsequent claim for coverage null, void, and unenforceable.
      </p>

      <h4 className="text-base font-bold text-white">9.2 Scope of Limited Coverage and Credit Limit</h4>
      <p>
        The HPP is not an insurance policy, nor is it a comprehensive warranty. It is a contractually limited liability
        reduction agreement. For valid, approved claims, the HPP reduces the Customer&apos;s direct out-of-pocket
        financial exposure by providing a single, non-cumulative credit capped at a strict maximum of {credit} (the
        &quot;Credit Limit&quot;) per rental period. This credit shall be applied solely toward the actual, verified
        cost of necessary repairs or mechanical parts replacement directly necessitated by sudden, unforeseen, and
        accidental physical hardware damage to the specific Eligible Systems defined in Section 9.3. The Customer shall
        remain strictly liable for all repair, diagnostic, labor, and replacement costs exceeding the {credit} Credit
        Limit.
      </p>

      <h4 className="text-base font-bold text-white">9.3 Definition of Covered Eligible Systems</h4>
      <p>
        Coverage under this HPP is strictly limited to physical components within the following four (4) defined
        trailer systems. No other parts, structural components, or systems of the Sure-Trac equipment are covered:
      </p>
      <ul className="list-disc list-inside space-y-2 ml-2">
        <li>
          <strong>(a) Auto-Tarping Systems:</strong> Limited exclusively to the factory-installed motorized tarping
          assembly, mechanical articulation linkages, pivot arms, tension springs, drive gears, and integrated mounting
          bracket hardware.
        </li>
        <li>
          <strong>(b) Wireless Remote Systems:</strong> Limited exclusively to the factory-provided handheld wireless
          transmitter units, internal electrical receiver modules, protective control box enclosures, and the primary
          electrical wiring harnesses feeding the receiver.
          <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
            <li>
              <strong>(i) Scope of Coverage:</strong> This plan strictly covers only verified physical, external damage
              or sudden internal mechanical or electrical operational failures.
            </li>
            <li>
              <strong>(ii) Absolute Loss Exclusion:</strong> The Customer bears absolute liability and financial
              responsibility for the continuous physical possession of the remote unit. Under no circumstances does
              this HPP provide coverage for, and it explicitly excludes, any lost, misplaced, stolen, unaccounted for,
              or mysteriously vanished handheld remote units or components.
            </li>
            <li>
              <strong>(iii) Condition Precedent (Physical Surrender):</strong> As a mandatory condition precedent to
              receiving any credit under this HPP for a remote system claim, the Customer must physically surrender and
              return the inoperable or damaged handheld remote unit to the Company&apos;s shop for inspection. Failure
              to return the physical unit shall create an irrefutable presumption that the unit is lost, thereby
              voiding all HPP coverage for the claim.
            </li>
            <li>
              <strong>(iv) Unreturned Equipment Fee:</strong> If the handheld remote unit is lost, stolen, or otherwise
              not physically surrendered to the Company, the Customer shall be charged a minimum equipment replacement
              fee of {remoteFee} per unit. That amount is a minimum only and the charge may be more, up to the
              Company&apos;s then-current cost to obtain a replacement, as stated in Section 9.6. The fee is billed
              immediately to the Customer&apos;s payment method on file and is entirely exempt from any HPP credit
              application.
            </li>
          </ul>
        </li>
        <li>
          <strong>(c) Hydraulic Lift Systems:</strong> Limited exclusively to the main hydraulic power unit pump
          assembly, hydraulic lift rams, dual or single cylinders, high-pressure fluid lines, hydraulic hoses, fittings,
          couplers, and the fluid reservoir tank.
        </li>
        <li>
          <strong>(d) Winch and Trailer Safety Lighting Assemblies:</strong> Limited exclusively to the electrical winch
          motor assembly, winch housing, metal cable or synthetic strap, and integrated factory trailer safety lighting
          systems, including LED light fixtures, reflective lenses, and structural trailer wiring bundles.
        </li>
      </ul>

      <h4 className="text-base font-bold text-white">9.4 Absolute Exclusions and Zero-Coverage Conditions</h4>
      <p>
        The HPP provides zero coverage, shall immediately terminate, and shall be deemed contractually void if, in the
        sole and absolute discretion of the Company, the hardware damage is determined to have been caused by,
        contributed to, or arising from any of the following:
      </p>
      <ul className="list-disc list-inside space-y-2 ml-2">
        <li>
          <strong>(a) Overloading:</strong> Any operation, loading, or hauling of materials exceeding the
          manufacturer&apos;s specified Gross Vehicle Weight Rating (GVWR) or the trailer&apos;s rated payload capacity.
        </li>
        <li>
          <strong>(b) Improper Operational Procedures:</strong> Any failure to operate the equipment in accordance with
          manufacturer guidelines, including but not limited to improper tarping procedures, operating the hydraulic
          system on uneven ground, or failing to secure components during transit resulting in mechanical or structural
          failure.
        </li>
        <li>
          <strong>(c) Negligence and Misconduct:</strong> Any act of gross negligence, reckless operation, willful
          misconduct, intentional destruction, or criminal activity by the Customer, their employees, agents, or
          subcontractors.
        </li>
        <li>
          <strong>(d) Environmental and Unrelated Damage:</strong> Damage caused by acts of God, extreme weather events,
          chemical corrosion, standard wear and tear, cosmetic degradation, or third-party vehicular accidents.
        </li>
        <li>
          <strong>(e) Theft and Disappearance:</strong> Any mysterious disappearance, theft, or total loss of the
          equipment, or parts thereof, is strictly excluded from this plan.
        </li>
      </ul>

      <h4 className="text-base font-bold text-white">9.5 Claim Reporting Procedures and Conditions Precedent</h4>
      <p>
        To successfully invoke coverage under the HPP, the Customer must strictly adhere to the following procedural
        conditions precedent. Failure to comply with any single condition shall result in a total forfeiture of HPP
        benefits:
      </p>
      <ul className="list-disc list-inside space-y-2 ml-2">
        <li>
          <strong>(a) Immediate Notice:</strong> The Customer must report the exact accidental damage to the Company in
          writing within twenty-four (24) hours of the occurrence, or immediately upon the termination of the rental
          period, whichever occurs first.
        </li>
        <li>
          <strong>(b) Inspection Rights:</strong> No repairs may be initiated, and no parts may be replaced, without the
          prior written authorization of the Company. The Company reserves the absolute right to inspect the damaged
          equipment prior to the application of any HPP credit.
        </li>
        <li>
          <strong>(c) Customer Portal Support Ticket:</strong> Written notice may also be given by filing a hardware
          damage claim in the Customer Portal Communication Hub, under Support Tickets, at{' '}
          <Link
            to="/customer-portal?tab=messages&section=tickets"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            Customer Portal — Support Tickets
          </Link>
          . The date and time saved on that ticket is the Customer&apos;s written notice for the twenty-four (24) hour
          requirement in Section 9.5(a). Photographs attached to that ticket are part of the notice and are kept with
          the Customer&apos;s file. This portal claim is another way to communicate a problem. It does not replace the
          inspection rights in Section 9.5(b).
        </li>
      </ul>

      <h4 className="text-base font-bold text-white">9.6 Non-Surrender Equipment Fees for Missing Components</h4>
      <p>
        The HPP reduces liability strictly for damaged parts that are left attached to the equipment or returned
        physically to the Company for repair validation. If any critical operational component, accessory, or
        sub-assembly is missing entirely from the equipment upon check-in, or if the Customer cannot physically produce
        the damaged item for inspection, the HPP is void for that specific item. The Customer shall be charged at least
        the minimum fee in the schedule below, billed to the Customer&apos;s payment method on file. Each listed amount
        is a minimum fee only. The actual charge may be more. It is the greater of the listed minimum and the
        Company&apos;s then-current cost to obtain that part, including supplier price, availability, shipping, and the
        rate in effect when the Company orders the part or assesses the charge.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-2">
        <li>
          <strong>(a)</strong> Missing Wireless Remote Transmitter (Hydraulic or Tarp): minimum fee of {remoteFee} per
          unit, and the charge may be more.
        </li>
        <li>
          <strong>(b)</strong> Missing Winch Controller / Handheld Pendant: minimum fee of {winchFee} per unit, and the
          charge may be more.
        </li>
        <li>
          <strong>(c)</strong> Missing Safety Lighting Fixture Assemblies (LED Bars/Pods): minimum fee of {lightingFee}{' '}
          per fixture, and the charge may be more.
        </li>
        <li>
          <strong>(d)</strong> Missing Detachable Hydraulic Hoses / Couplers: minimum fee of {hoseFee} per line, and the
          charge may be more.
        </li>
        <li>
          <strong>(e)</strong> Missing Tarp Tension Springs or Articulation Arms: minimum fee of {tarpFee} per side
          assembly, and the charge may be more.
        </li>
      </ul>
      <p>
        <strong>Right to Change These Amounts Without Notice:</strong> The Company may change any fee, rate, or charge
        stated in this Hardware Protection Plan, including every minimum listed above and the HPP Fee, at any time
        without prior notice to the Customer. A charge is calculated at the amount in effect when it is incurred, and
        a missing or replacement part is never billed for less than the minimum then in effect.
      </p>

      <h4 className="text-base font-bold text-white">9.7 Immediate Credit Card Authorization and Auto-Billing</h4>
      <ul className="list-disc list-inside space-y-2 ml-2">
        <li>
          <strong>(a) Explicit Authorization to Charge:</strong> By executing these Master Terms and Conditions and
          enrolling in the HPP, the Customer provides the Company with an irrevocable, explicit, and pre-authorized
          directive to immediately charge any credit card, debit card, or banking payment profile on file with the
          Company for any and all fees, penalties, or cost overages incurred under this Section 9.
        </li>
        <li>
          <strong>(b) Scope of Auto-Billing:</strong> This immediate billing authorization applies without limitation to:
          <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
            <li>
              (i) The full amount of any unreturned or missing equipment fees set forth in the schedule under Section
              9.6;
            </li>
            <li>
              (ii) The actual, commercial cost of any equipment repairs, diagnostics, and parts replacement that exceed
              the {credit} HPP Credit Limit; and
            </li>
            <li>(iii) Any administration fees associated with processing the damage claim.</li>
          </ul>
        </li>
        <li>
          <strong>(c) Timing of Charges:</strong> The Company reserves the absolute right to process these charges
          immediately upon the physical check-in and initial inspection of the trailer equipment, or within a maximum of
          fifteen (15) business days following the termination or return of the rental equipment, without further notice
          to, or explicit consent from, the Customer.
        </li>
        <li>
          <strong>(d) Waiver of Chargebacks:</strong> The Customer explicitly acknowledges that these charges are
          contractually pre-authorized and agreed upon as liquidated damages to cover missing or damaged assets. The
          Customer hereby waives any right to dispute, challenge, or initiate a chargeback with their credit card issuer
          or financial institution for any fees billed under this Section 9.
        </li>
      </ul>

      <h4 className="text-base font-bold text-white">9.8 Mandatory Pre-Rental Photographic Documentation</h4>
      <p>
        As a strict condition precedent to the activation and validity of the HPP, the Customer, or an authorized
        representative of the Company, must capture time-stamped, high-resolution photographic documentation of all four
        (4) Eligible Systems outlined in Section 9.3 immediately prior to the trailer departing the Company&apos;s
        premises. These photographs shall establish the baseline physical and operational condition of the hardware.
        Failure by the Customer to ensure these baseline photos are recorded and filed with the rental agreement shall
        completely void the HPP coverage, leaving the Customer fully liable for all subsequent repair costs from dollar
        one.
      </p>
    </div>
  );
}
