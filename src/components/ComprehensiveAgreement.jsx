
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, ClipboardSignature as Signature, ArrowLeft, Loader2, ArrowRight } from 'lucide-react';

const AgreementText = () => (
    <div className="prose prose-sm prose-invert text-blue-200 max-w-none space-y-4">
        <h2 className="text-xl text-center font-bold text-yellow-300">RENTAL AGREEMENT</h2>
        <p>This Rental Agreement ("Agreement") is made effective as of the date of Customer's electronic or written acceptance, by and between <strong>U-Fill Dumpsters LLC</strong> ("Company"), a Utah limited liability company, and the individual or entity identified as the customer on the booking ("Customer"). Company contact: [Company Address placeholder], (801) 810-8832, support@u-filldumpsters.com.</p>

        <h3 className="text-lg text-yellow-300">Definitions</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>"Equipment"</strong> means dumpsters, dump-loader trailers, delivery vehicles, or other rental units provided by Company.</li>
            <li><strong>"Small Equipment"</strong> means wheelbarrows, hand trucks, tools, or other supplementary items rented by Customer.</li>
            <li><strong>"Rental Period"</strong> means the period beginning on the delivery date/time and ending when Company retrieves the Equipment, as scheduled or extended in writing.</li>
            <li><strong>"Fill Line"</strong> means the manufacturer's or Company's marked maximum fill height.</li>
            <li><strong>"Dry Run"</strong> means a scheduled delivery or pickup attempt that cannot be completed due to Customer's fault or access issues.</li>
            <li><strong>"Prohibited Materials"</strong> means hazardous materials and other items listed in Section 5.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Acceptance of Terms</h3>
        <p>By booking, paying, or taking possession of Equipment, Customer acknowledges they have read, understand, and agree to be bound by this Agreement and any applicable addenda. This Agreement governs all rentals, bookings, and related services. Customer assumes all risks not explicitly covered by optional protection plans.</p>

        <h3 className="text-lg text-yellow-300">Rental, Delivery & Pickup</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Rental Period:</strong> Begins on delivery and ends on scheduled pickup. Extensions must be requested at least 24 hours before scheduled pickup and are subject to availability and applicable extension fees (Extension fee: $75).</li>
            <li><strong>Delivery & Pickup Windows:</strong> Standard delivery and pickup windows will be provided at booking. Timed deliveries or after-hours requests may incur additional fees.</li>
            <li><strong>Placement & Access:</strong> Customer must provide a safe, stable placement site on private property unless street/curb placement with required permits has been agreed. The site must be clear of overhead obstructions and able to support the weight of Equipment and vehicles. Customer is responsible for obtaining any permits for public/street placement and for compliance with local ordinances.</li>
            <li><strong>Stuck Vehicles:</strong> If Company vehicle becomes stuck due to unstable ground conditions (mud, soft soil, poor drainage) at Customer's requested site, Customer is responsible for all towing, recovery, and associated costs.</li>
            <li><strong>Dry Run:</strong> If the Company cannot complete delivery or pickup due to the Customer's fault (blocked access, parked vehicles, locked gates, unsafe conditions, lack of permits), the Customer will be charged a Dry Run fee equal to 50% of the original service cost and any additional charges incurred by the Company.</li>
            <li><strong>Unauthorized Movement:</strong> Customer shall NOT move, relocate, or operate Equipment without explicit written authorization from Company. Any damage resulting from unauthorized movement is Customer's sole responsibility and will be charged in full.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Fees, Payment & Taxes</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Payment:</strong> Full payment, including taxes and any applicable deposits or add-on fees, is due at booking to secure the reservation unless otherwise agreed in writing. Customer authorizes Company to charge the payment method on file for all charges, fees, damages, and fines incurred under this Agreement.</li>
            <li><strong>Base Rates & Inclusions:</strong> <em>If Dumpster Delivery Rental is chosen, then the following statement is applicable:</em> Base rental price includes one delivery and one pickup. Disposal is billed separately at $45.00 per ton based on the actual post-disposal scale weight; disposal charges are calculated after disposal and charged to the Customer’s payment method on file. The Customer authorizes Company to bill for any disposal charges, overweight fees, and other applicable fees incurred under this Agreement.</li>
            <li><strong>Overweight & Overage Charges:</strong> Overweight charges for dumpsters are $100 per ton over the allowed 2.5 tons. Dump Loader Trailer overage rate: 4.5 tons. Customer is responsible for any overweight citations or penalties imposed by authorities.</li>
            <li><strong>Municipal Dump Fees & Special Item Fees:</strong> Customer is responsible for municipal dump fees at cost: $150 plus $45/ton. Special-item disposal fees (mattresses, electronics, appliances, TVs, appliances with refrigerant unless certified removal provided, etc.) apply (typical range $20–$50 per item or actual disposal cost).</li>
            <li><strong>Cleaning Fee:</strong> If the Equipment is returned or left in a dirty condition requiring cleaning by the Company, a cleaning fee of $20 will apply.</li>
            <li><strong>Cancellation & Refunds:</strong> Cancellations more than 24 hours before scheduled delivery: 10% cancellation fee of the order total retained; balance refunded. Cancellations 24 hours or less before scheduled delivery: Up to 50% of the order total charged, plus a 10% cancellation fee of the order total retained. No-shows or refusal of equipment at delivery may result in full rental charges. Refunds are processed within one to two business days and should reflect in accounts within 5–10 business days. However, in some rare cases, refunds may take up to 30 days from the date the rental was canceled. Customer may request their ARN (Acquirer Reference Number) number through the customer portal, where the ARN number will be provided to them within one to two business days upon request.</li>
            <li><strong>Charge Authorization:</strong> Customer authorizes Company to charge Customer’s payment method on file for any of the dump disposal fees, unpaid balance, fees, damages, fines, collection costs, and attorneys’ fees incurred under this Agreement.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Weight Limits, Loading & Prohibited Materials</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Weight Limits:</strong> 16-yard dumpsters may dispose of up to 2.5 tons (5,000 lbs. limit). Dump Loader Trailers have a 5-ton limit; dirt/soil loads must not exceed halfway up trailer walls. Overweight loads will be subject to immediate additional charges and possible refusal of pickup until corrected.</li>
            <li><strong>Moisture & Weight:</strong> Customer is responsible for the total scale weight of Equipment and materials regardless of water, snow, ice, or other moisture accumulated during the rental period.</li>
            <li><strong>Loading & Fill Line:</strong> Do not exceed the Fill Line. Do not place materials that may fall or blow out during transport. Do not obstruct the Company's access to lift points.</li>
            <li><strong>Prohibited Materials - Enhanced:</strong> Customer shall not place hazardous materials including paints, solvents, chemicals, asbestos, oils, liquids, pesticides, medical or biological waste, radioactive materials, explosives, compressed gas cylinders, PCB-containing items, tires (unless pre-approved), batteries, appliances containing refrigerant/Freon (unless refrigerant has been professionally removed and documented), large concrete chunks or boulders exceeding reasonable size, contaminated soils, or any other regulated hazardous waste. Discovery of prohibited items will result in immediate termination of the rental and remediation at the Customer's full expense. Costs for proper disposal of hazardous materials and any damage to equipment will be assessed. Additionally, daily rental fees will continue to be charged until equipment is returned to service and, if necessary, cleared by proper authorities.</li>
            <li><strong>Special Handling Fees:</strong> Items requiring special handling or disposal (mattresses, electronics, appliances, asbestos materials, large concrete) will incur additional fees based on type and weight.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Aggregate & Material Delivery</h3>
        <ul className="list-disc list-inside space-y-2">
            <li>Once material is dumped at the requested location, Company is not responsible for moving, spreading, or leveling it.</li>
            <li>Materials are natural products; Company does not guarantee exact color or texture matches.</li>
            <li>All sales of aggregate are final once dumped.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Small Equipment Rental (Wheelbarrows, Hand Trucks)</h3>
        <ul className="list-disc list-inside space-y-2">
            <li>Customer is responsible for the condition, theft, loss, or destruction of Small Equipment.</li>
            <li>Broken or missing items will be charged at full retail replacement cost plus a 15% administrative fee.</li>
            <li>Customer assumes all risk of bodily injury from use of Small Equipment.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Customer Responsibilities & Representations</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Subsurface & Property Damage:</strong> Customer must disclose all underground utilities, septic systems, irrigation lines, and other subsurface structures. Company is not liable for damage to undisclosed or inadequately protected subsurface structures. Company is not liable for scuffing, indentation, or surface damage to driveways, pavers, or landscaping from Equipment weight or material placement.</li>
            <li><strong>Permits & Compliance:</strong> Customer is responsible for obtaining and paying for any permits, licenses, or approvals required by local authorities for placement or use of Equipment on public property.</li>
            <li><strong>Site Condition:</strong> Customer represents that the placement site is stable and capable of supporting Equipment and delivery vehicles and that no underground utilities, sprinkler systems, or other obstructions are present unless disclosed.</li>
            <li><strong>Supervision & Use:</strong> Customer is responsible for supervising the use of Equipment and ensuring compliance with this Agreement by Customer’s agents, contractors, and invitees.</li>
            <li><strong>Photos & Inspection:</strong> The Company may photograph Equipment at delivery and pickup for records. The customer is encouraged to document the site and property condition prior to delivery.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Damage, Loss, Insurance & Liability</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Assumption of Risk:</strong> Customer assumes all risk of loss, theft, damage, or injury associated with the Equipment during the Rental Period, except to the extent caused by Company’s gross negligence or willful misconduct.</li>
            <li><strong>Damage Charges:</strong> Customer is responsible for repair or replacement costs for any damage to Equipment beyond normal wear and tear. The company may charge the Customer’s payment method for such costs plus administrative fees.</li>
            <li><strong>Optional Add-Ons:</strong> Driveway Protection and Hardware Protection (where applicable) is available for $15; Rental Insurance is available for $20. If Customer declines either optional add-on, Customer accepts responsibility for potential driveway/property/hardware damage and Equipment damage or loss as described in this Agreement.</li>
            <li><strong>Insurance:</strong> Customer should maintain appropriate liability and property insurance covering Customer’s activities and property during the Rental Period. The company’s insurance covers only the Company’s operations.</li>
            <li><strong>Indemnification:</strong> To the fullest extent permitted by law, Customer shall indemnify, defend, and hold harmless Company and its owners, officers, agents, and employees from all claims, liabilities, losses, damages, costs, and expenses (including attorneys’ fees and court costs) arising from Customer’s use, possession, placement, loading, or maintenance of Equipment, except to the extent caused by Company’s gross negligence or willful misconduct.</li>
        </ul>
        
        <h3 className="text-lg text-yellow-300">Limitation of Liability</h3>
        <p>Except for liability arising from the Company’s gross negligence or willful misconduct, the Company’s total liability under this Agreement shall not exceed the amount paid by the Customer for the specific rental giving rise to the claim, except where prohibited by law. Company shall not be liable for consequential, incidental, special, punitive, or indirect damages.</p>

        <h3 className="text-lg text-yellow-300">Remedies, Collections & Attorney Fees</h3>
        <p>The company may retain deposits, charge the Customer’s payment method on file, and pursue legal remedies for unpaid charges, damages, fines, or recovery costs. Customer shall pay all reasonable collection costs, including attorneys’ fees and court costs, if Company enforces this Agreement.</p>

        <h3 className="text-lg text-yellow-300">Environmental & Legal Compliance</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Disposal & Environmental Laws:</strong> Customer warrants that materials placed in Equipment are not regulated hazardous wastes and will comply with federal, state, and local laws. Customer will reimburse Company for any fines, cleanup, or disposal costs arising from improper disposal by Customer.</li>
            <li><strong>Right to Inspect & Reject:</strong> Company reserves the right to inspect contents, reject, or remove prohibited items. The company may require the Customer to remove offending materials prior to pickup.</li>
        </ul>

        <h3 className="text-lg text-yellow-300">Permits, Fines & Towing</h3>
        <p>Customer is responsible for securing permits for placement on public property and for any fines, towing, impound, or other charges resulting from noncompliance. The company may charge retrieval and administrative fees if the Equipment is towed or impounded.</p>

        <h3 className="text-lg text-yellow-300">Termination</h3>
        <p>The Company may terminate this Agreement and remove Equipment immediately if Customer breaches any material term, creates hazardous conditions, or uses Equipment for unlawful purposes. Termination does not relieve Customer of payment obligations for services performed or damages incurred.</p>

        <h3 className="text-lg text-yellow-300">Lien Rights</h3>
        <p>Pursuant to Utah law, Company reserves the right to file a mechanic's lien against the property for unpaid services that improve the property (e.g., aggregate delivery, equipment rental, or other services rendered).</p>

        <h3 className="text-lg text-yellow-300">Dispute Resolution & Governing Law</h3>
        <p>This Agreement is governed by the laws of the State of Utah. Customer and Company consent to the exclusive jurisdiction and venue of the state and federal courts located in Utah County, Utah. Parties may alternatively elect binding arbitration under the American Arbitration Association rules; arbitration shall be held in Utah County, Utah, if both parties agree in writing.</p>

        <h3 className="text-lg text-yellow-300">Notices</h3>
        <p>All notices shall be in writing and delivered to the addresses provided at booking or to the Company at support@u-filldumpsters.com, (801) 810-8832. Notices by email are effective upon transmission; mailed notices are effective upon receipt.</p>

        <h3 className="text-lg text-yellow-300">Electronic Signatures & Acknowledgments</h3>
        <p>Customer’s electronic acceptance, clicking “I Agree,” or providing a written/electronic signature constitutes a binding signature. Customer affirms they are at least 18 years old and have the authority to enter into this Agreement on behalf of any entity they represent.</p>

        <h3 className="text-lg text-yellow-300">Miscellaneous</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Entire Agreement:</strong> This Agreement, including any addenda or attachments, constitutes the entire agreement and supersedes prior agreements.</li>
            <li><strong>Severability:</strong> If any provision is invalid or unenforceable, the remainder remains in effect.</li>
            <li><strong>Waiver:</strong> Failure to enforce any provision is not a waiver of future enforcement.</li>
            <li><strong>Assignment:</strong> Customer may not assign this Agreement without the Company’s prior written consent. The company may assign or subcontract obligations.</li>
            <li><strong>Amendment:</strong> Any amendment must be in writing and signed by both parties.</li>
        </ul>
        
        <p className="font-bold pt-4">By clicking "I Agree," or by providing a written/electronic signature below, Customer acknowledges they have read, understand, and agree to this Agreement and any selected addenda.</p>
    </div>
);

export const ComprehensiveAgreement = ({ onBack, onAccept, bookingData, isProcessing }) => {
    const [signature, setSignature] = useState('');
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [error, setError] = useState('');

    const expectedName = `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim();

    // Debugging logs to verify state changes
    useEffect(() => {
        console.log('[Agreement Debug] Signature:', signature);
        console.log('[Agreement Debug] Agreed to Terms:', agreedToTerms);
        console.log('[Agreement Debug] Expected Name:', expectedName);
    }, [signature, agreedToTerms, expectedName]);

    const handleSubmit = () => {
        const trimmedSignature = signature.trim();
        
        if (trimmedSignature.toLowerCase() !== expectedName.toLowerCase()) {
            setError(`Signature must exactly match the name on the booking: ${expectedName}`);
            return;
        }
        
        if (!agreedToTerms) {
            setError('You must check the box to agree to the terms.');
            return;
        }

        setError('');
        console.log('[Agreement] Validation passed, proceeding to accept.');
        onAccept();
    };

    // Button disabled state logic as requested: 
    // Disabled only if signature is empty (after trim) OR checkbox not checked
    const isButtonDisabled = !signature.trim() || !agreedToTerms || isProcessing;

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
                    <h2 className="text-3xl font-bold text-white">Rental Agreement & Signature</h2>
                </div>

                <p className="text-blue-200 mb-4">Please read the following agreement carefully. Your electronic signature is required to proceed.</p>

                <ScrollArea className="h-[40vh] w-full rounded-md border border-white/30 bg-black/20 p-4 mb-6">
                    <AgreementText />
                </ScrollArea>

                <div className="space-y-4">
                    <div>
                        <Label htmlFor="signature" className="text-lg font-semibold text-white flex items-center mb-2">
                            <Signature className="mr-2 h-5 w-5 text-yellow-400"/>
                            E-Signature
                        </Label>
                        <p className="text-sm text-blue-200 mb-2">Please type your full name as it appears on the booking: <strong className="text-yellow-300">{expectedName}</strong></p>
                        <Input 
                            id="signature"
                            type="text"
                            placeholder="Type your full name here"
                            value={signature}
                            onChange={(e) => {
                                setSignature(e.target.value);
                                if (error) setError(''); // Clear error on change
                            }}
                            className="bg-white/10 border-white/30 text-white placeholder-blue-200 focus:ring-yellow-400"
                        />
                    </div>

                    <div className="flex items-center space-x-3 pt-2">
                        <Checkbox 
                            id="terms-agree" 
                            checked={agreedToTerms}
                            onCheckedChange={(checked) => {
                                setAgreedToTerms(checked);
                                if (error) setError(''); // Clear error on change
                            }}
                            className="border-white/50 data-[state=checked]:bg-yellow-400 h-6 w-6"
                        />
                        <Label htmlFor="terms-agree" className="text-sm text-white cursor-pointer select-none">
                            I have read, understood, and agree to be bound by the entire Rental Agreement.
                        </Label>
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
                        {isProcessing ? (
                            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                        ) : null}
                        {isProcessing ? 'Processing...' : (
                            <div className="flex items-center justify-center">
                                Agree & Continue <ArrowRight className="ml-2 h-6 w-6" />
                            </div>
                        )}
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};
