import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';

const dumpsterAgreement = [
    { title: "1. Rental Terms", content: "The rental period begins on the delivery date and ends on the scheduled pickup date. Extensions are available for an additional daily fee." },
    { title: "2. Permitted Materials", content: "Acceptable materials include household debris, construction waste, yard waste, and furniture. Prohibited items include hazardous materials, chemicals, paint, liquids, batteries, tires, and appliances containing freon." },
    { title: "3. Weight Limits", content: "Each dumpster has a specified weight limit. Overage fees apply for exceeding the weight limit at $100 per ton." },
    { title: "4. Placement Requirements", content: "Customer must provide a suitable location for dumpster placement on their property, such as a driveway. The dumpster may not be placed on public roads unless the customer has obtained explicit clearance from the city. Customer is responsible for any damage to property caused by dumpster placement." },
    { title: "5. Payment Terms", content: "Payment is due at the time of booking. Additional fees may apply for prohibited materials, overage weight, or extended rental periods." },
    { title: "6. Liability", content: "Customer assumes responsibility for the dumpster during the rental period and agrees to indemnify U-Fill Dumpsters LLC against any claims arising from the rental." },
    { title: "7. Cancellation Policy", content: "Cancellations made 24 hours before delivery receive a full refund. Cancellations made less than 24 hours before delivery are subject to a 50% cancellation fee." },
    { title: "8. Dry Run & Extension Policy", content: "If our driver is unable to pick up or deliver a dumpster due to obstructions or customer unreadiness (a 'dry run'), a $125 fee will be assessed. To avoid this, any rental extensions must be scheduled at least 24 hours prior to the original pickup time. Failure to provide timely notice may result in a dry run fee if our driver arrives and the dumpster is not ready for removal." },
    { title: "9. Overfilling and Prohibited Items", content: "Customer shall not fill the dumpster above the marked fill line. Overfilling may result in a removal fee, additional charges, and/or assessment of a 'dry run' fee if the dumpster cannot be safely transported. Items such as large rocks, dirt, tires, batteries, paint, general liquids, TVs, mattresses, appliances, and large furniture are strictly prohibited and will incur separate individual charges ranging from $20 to $50 per item if found in the dumpster." }
];

const dumploaderAgreement = [
    { title: "1. Rental Period", content: "The rental period begins on the customer pickup date and ends on the scheduled return date. Rentals are available for pickup beginning at 8:00 a.m. on the scheduled date. The full daily rate applies regardless of pickup time. All rentals must be returned by 10:00 p.m. on the final day of the rental period to avoid late fees or an additional full-day charge." },
    { title: "2. Prohibited Materials & Weight Restrictions", content: "The following items are strictly prohibited: large boulders, concrete chunks, hazardous materials, chemicals, and liquids. Due to extreme weight, dirt and soil may only fill the trailer partially (no more than halfway). The customer is solely responsible for complying with all weight capacity regulations." },
    { title: "3. Customer Liability & Damages", content: "The customer assumes all responsibility and liability for the dump loader from the time of pickup until it is returned. This includes, but is not limited to, any damage to the trailer, tires, hydraulic systems, or tarp. The customer is responsible for the full cost of repairs for any damages incurred." },
    { title: "4. Late Fees & Cleaning Charges", content: "A late fee will be assessed for each day the dump loader is not returned after the agreed-upon date. The trailer must be returned clean and free of debris. A minimum cleaning fee of $20 will be charged if the trailer is returned dirty." },
    { title: "5. Safe Operation", content: "The customer affirms they have the necessary knowledge and a capable vehicle to safely tow and operate the dump loader. U-Fill Dumpsters LLC is not liable for any accidents, injuries, or property damage caused by the customer's operation of the equipment." }
];

export const UserAgreement = ({ plan, onClose, onAccept }) => {
  const agreementContent = plan?.id === 2 ? dumploaderAgreement : dumpsterAgreement;
  const agreementTitle = plan?.id === 2 ? "Dumploader Rental Agreement" : "Dumpster Rental Agreement";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-gradient-to-b from-indigo-900 to-purple-900 rounded-2xl shadow-2xl border border-white/20 w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-white/20">
          <h2 className="text-2xl font-bold text-yellow-400">{agreementTitle}</h2>
          <p className="text-blue-200">Please read and accept the terms to proceed.</p>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {agreementContent.map((item, index) => (
            <div key={index}>
              <h3 className="font-semibold text-white text-lg mb-1">{item.title}</h3>
              <p className="text-blue-200 text-sm">{item.content}</p>
            </div>
          ))}
        </div>
        <div className="p-6 border-t border-white/20 flex justify-between items-center">
            <Button asChild variant="ghost" className="text-blue-200 hover:bg-white/10 hover:text-white">
              <Link to="/faq" target="_blank" rel="noopener noreferrer">
                <HelpCircle className="mr-2 h-4 w-4" />
                View FAQ
              </Link>
            </Button>
            <div className="flex space-x-4">
                <Button variant="outline" onClick={onClose} className="border-yellow-400 text-yellow-400 hover:bg-yellow-400/10 hover:text-yellow-300">
                    Decline
                </Button>
                <Button onClick={onAccept} className="bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black font-semibold">
                    Accept & Continue
                </Button>
            </div>
        </div>
      </motion.div>
    </motion.div>
  );
};