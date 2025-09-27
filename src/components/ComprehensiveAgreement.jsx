import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, ClipboardSignature as Signature, ArrowLeft, ArrowRight } from 'lucide-react';

const AgreementText = ({ isDelivery }) => (
    <div className="prose prose-sm prose-invert text-blue-200 max-w-none space-y-4">
        <p>This Rental Agreement ("Agreement") is made and entered into by and between U-Fill Dumpsters LLC ("Company") and the customer ("Customer") executing this agreement. This document constitutes a legally binding contract governing the rental of equipment and/or services provided by the Company.</p>

        <h3 className="text-yellow-300">Section 1: General Terms & Conditions</h3>
        <p>By proceeding with this booking, the Customer acknowledges they have read, understood, and agree to be bound by all terms, conditions, and policies outlined herein. This Agreement applies to all services offered, including but not limited to 16-Yard Dumpster Rentals, Dump Loader Trailer Rentals, and Material Deliveries.</p>

        <h3 className="text-yellow-300">Section 2: Service-Specific Terms</h3>
        
        <h4 className="text-white">A. 16-Yard Dumpster Rental</h4>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Rental Period:</strong> The rental period begins on the delivery date and concludes on the scheduled pickup date. Extensions must be requested at least 24 hours in advance and are subject to availability and additional daily fees ($50/day unless a weekly special is applied).</li>
            <li><strong>Pricing:</strong> The base price includes one-time delivery, pickup, and disposal of up to 2.5 tons of debris. A weekly special rate of $500 for 7 days is available.</li>
            <li><strong>Placement & Access:</strong> The Customer must provide a safe, clear, and accessible location on private property (e.g., driveway). The location must be on solid ground, free from overhead obstructions, and capable of withstanding the weight of the dumpster and delivery truck. Any placement on public streets is the sole responsibility of the Customer, who must obtain all necessary permits and assumes all liability for fines or violations. If our driver cannot access the location for delivery or pickup due to obstructions (e.g., parked cars, locked gates), a "Dry Run" fee of $125 will be charged.</li>
        </ul>

        {!isDelivery && (
            <>
                <h4 className="text-white">B. Dump Loader Trailer Rental (Self-Service)</h4>
                <ul className="list-disc list-inside space-y-2">
                    <li><strong>Rental Period:</strong> Pickup is available from 8:00 AM on the scheduled start date. The trailer must be returned by 10:00 PM on the scheduled end date to the specified pickup/return location, which will be provided upon successful booking and payment. Late returns will incur a full additional day's rental charge.</li>
                    <li><strong>Customer Responsibility & Towing:</strong> The Customer affirms they possess a capable towing vehicle equipped with a 2-5/16" ball hitch and the necessary skills to operate the equipment safely. The Customer assumes all liability for the trailer from the moment of pickup until its return, including any and all damages to tires, hydraulics, tarp, and structure.</li>
                    <li><strong>Cleaning:</strong> The trailer must be returned completely swept out and free of all debris. A minimum cleaning fee of $20 will be charged if the unit is returned dirty.</li>
                </ul>
            </>
        )}

        {isDelivery && (
            <>
                <h4 className="text-white">C. Dump Loader Trailer (Delivery Service)</h4>
                <ul className="list-disc list-inside space-y-2">
                    <li><strong>Service Scope:</strong> This service is for drop-off and pickup of the Dump Loader Trailer only. Drop-off is scheduled between 6:00 AM - 8:00 AM, and pickup is scheduled between 10:00 PM - 11:30 PM.</li>
                    <li><strong>Placement:</strong> This service is for curbside/street placement. The Customer is solely responsible for checking and complying with all local city ordinances regarding street placement. U-Fill Dumpsters LLC is not liable for any fines, fees, or towing charges.</li>
                    <li><strong>Liability & Fees:</strong> The Customer is liable for the equipment while in their possession. The service includes a flat delivery fee plus a mileage charge. The Customer is responsible for all dump fees ($45.00/ton, 2.5-ton maximum). A "Dry Run" fee will apply if the location is obstructed.</li>
                </ul>
            </>
        )}

        <h3 className="text-yellow-300">Section 3: Prohibited Materials & Weight Limits</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Weight Limits:</strong> Dumpsters are limited to 2.5 tons. Overweight loads will be charged an overage fee of $100 per ton. Dump Loader Trailers are limited to 5 tons, but materials like dirt and soil must not exceed halfway up the trailer walls. The Customer is responsible for all overweight citations.</li>
            <li><strong>Prohibited Materials:</strong> The following are strictly prohibited in all rentals: hazardous materials (paint, chemicals, asbestos, solvents, liquids), tires, batteries, appliances containing Freon, large boulders, and concrete chunks.</li>
            <li><strong>Special Handling Fees:</strong> Items such as mattresses and TVs will incur a separate disposal fee of $20 to $50 per item. The dumpster must not be filled above the marked "fill line." Overfilling will result in removal of items and/or a dry run fee if unsafe to transport.</li>
        </ul>

        <h3 className="text-yellow-300">Section 4: Fees, Payments, and Cancellations</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Payment:</strong> Full payment is due at the time of booking to secure the reservation. All prices are plus applicable taxes.</li>
            <li><strong>Cancellation Policy:</strong> Cancellations made more than 24 hours before the scheduled service date will receive a full refund. Cancellations made within 24 hours are subject to a 50% cancellation fee.</li>
            <li><strong>Additional Fees:</strong> The Customer agrees to pay all applicable fees, including but not limited to: overweight charges, prohibited item fees, late fees, dry run fees ($125), cleaning fees, and charges for any damage to the equipment.</li>
        </ul>

        <h3 className="text-yellow-300">Section 5: Liability, Damage, and Waivers</h3>
        <ul className="list-disc list-inside space-y-2">
            <li><strong>Assumption of Risk:</strong> The Customer assumes all risks and liability for the equipment during the rental period. This includes responsibility for any injury, property damage, or claims arising from the use, placement, or presence of the equipment.</li>
            <li><strong>Damage to Property (Driveways, etc.):</strong> The Company is not responsible for any damage to the Customer's property, including driveways, sidewalks, lawns, or underground utilities, resulting from the weight of the equipment or delivery truck. The Customer warrants that the placement location is sufficient to bear the weight.</li>
            <li><strong>Driveway Protection Waiver:</strong> If the Customer declines the optional Driveway Protection service, they explicitly acknowledge and agree that the Company is not liable for any potential damage, including but not limited to cracks, scratches, or stains, to the driveway or surrounding area.</li>
            <li><strong>Rental Insurance Waiver:</strong> If the Customer declines the optional Rental Insurance, they acknowledge and agree they are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during the rental period, and will be billed for the full cost of repairs or replacement.</li>
            <li><strong>Indemnification:</strong> The Customer agrees to indemnify, defend, and hold harmless U-Fill Dumpsters LLC, its owners, employees, and agents from any and all claims, damages, losses, and expenses, including attorney's fees, arising out of or resulting from the rental.</li>
        </ul>

        <p className="font-bold pt-4">By providing an electronic signature below, the Customer affirms they are of legal age, have the authority to enter into this agreement, and have read, understood, and voluntarily agree to all the terms and conditions set forth in this entire document.</p>
    </div>
);

export const ComprehensiveAgreement = ({ onBack, onAccept, bookingData, isDelivery }) => {
    const [signature, setSignature] = useState('');
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = () => {
        if (signature.trim().toLowerCase() !== bookingData.name.trim().toLowerCase()) {
            setError('Signature must exactly match the name on the booking.');
            return;
        }
        if (!agreed) {
            setError('You must check the box to agree to the terms.');
            return;
        }
        setError('');
        onAccept();
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
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center">
                        <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
                            <ArrowLeft />
                        </Button>
                        <h2 className="text-3xl font-bold text-white">Rental Agreement & Signature</h2>
                    </div>
                </div>

                <p className="text-blue-200 mb-4">Please read the following agreement carefully. Your electronic signature is required to proceed to payment.</p>

                <ScrollArea className="h-[40vh] w-full rounded-md border border-white/30 bg-black/20 p-4 mb-6">
                    <AgreementText isDelivery={isDelivery} />
                </ScrollArea>

                <div className="space-y-4">
                    <div>
                        <Label htmlFor="signature" className="text-lg font-semibold text-white flex items-center mb-2">
                            <Signature className="mr-2 h-5 w-5 text-yellow-400"/>
                            E-Signature
                        </Label>
                        <p className="text-sm text-blue-200 mb-2">Please type your full name as it appears on the booking: <strong className="text-yellow-300">{bookingData.name}</strong></p>
                        <Input 
                            id="signature"
                            type="text"
                            placeholder="Type your full name here"
                            value={signature}
                            onChange={(e) => setSignature(e.target.value)}
                            className="bg-white/10 border-white/30 text-white placeholder-blue-200"
                        />
                    </div>

                    <div className="flex items-center space-x-3 pt-2">
                        <Checkbox 
                            id="terms-agree" 
                            checked={agreed}
                            onCheckedChange={setAgreed}
                            className="border-white/50 data-[state=checked]:bg-yellow-400"
                        />
                        <Label htmlFor="terms-agree" className="text-sm text-white">
                            I have read, understood, and agree to be bound by the entire Rental Agreement.
                        </Label>
                    </div>

                    {error && (
                        <div className="flex items-center text-red-400 text-sm bg-red-900/50 p-3 rounded-md">
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            {error}
                        </div>
                    )}

                    <Button 
                        onClick={handleSubmit} 
                        disabled={!agreed || !signature}
                        className="w-full py-3 text-lg font-semibold bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Agree & Proceed to Payment
                        <ArrowRight className="ml-2" />
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};