import React from 'react';
    import { motion } from 'framer-motion';
    import { Button } from '@/components/ui/button';
    import { Link, useLocation } from 'react-router-dom';
    import { HelpCircle } from 'lucide-react';
    
    const dumpsterAgreement = [
        { title: "1. Fees & Payment", content: "Base price includes delivery and pickup. Disposal fees of $45.00/ton are billed separately after service. You authorize us to charge the card on file for all fees, including disposal, overweight charges ($100/ton over 2.5 tons), and a 10% cancellation fee (>24hrs) or up to 50% + 10% fee (<24hrs)." },
        { title: "2. Prohibited Materials", content: "Do not place hazardous materials (paints, chemicals, liquids), tires, or appliances with Freon in the dumpster. Fees apply for prohibited items." },
        { title: "3. Loading & Placement", content: "Do not fill above the marked 'Fill Line'. You are responsible for any damage to your property (driveway, etc.) from the dumpster's weight and placement." },
        { title: "4. Liability for Damage & Loss", content: "You are fully responsible for any damage to or loss of the dumpster and any rented equipment during your rental period. You authorize the Company to charge your payment method for the full repair or replacement cost." },
        { title: "5. Dry Run Fee", content: "If we cannot deliver or pickup due to blocked access, a 'Dry Run' fee of 50% of the service cost will be charged." }
    ];
    
    const dumploaderAgreement = [
        { title: "1. Rental Period & Fees", content: "Pickup is at 8:00 AM, return is by 10:00 PM. A $75 extension fee applies for late returns. Disposal fees ($45.00/ton) are billed after service. You authorize us to charge the card on file for all fees." },
        { title: "2. Prohibited Materials & Weight", content: "No hazardous materials, large concrete, or boulders. Dirt/soil loads must not exceed halfway up trailer walls. Max weight is 4.5 tons." },
        { title: "3. Full Liability for Equipment", content: "You are fully responsible for the dump loader and any other rented equipment from pickup until return. This includes damage, loss, or theft. You authorize the Company to charge your payment method for the full repair or replacement cost." },
        { title: "4. Safe Operation & Towing", content: "You must have a capable vehicle with a 2-5/16\" ball hitch. You are responsible for safe operation. A $20 cleaning fee applies if returned dirty." },
        { title: "5. Delivery Service", content: "If you chose delivery, you are responsible for checking local street placement ordinances. A 'Dry Run' fee of 50% of service cost applies if access is blocked for drop-off or pickup." },
    ];
    
    export const UserAgreement = ({ plan, onClose, onAccept }) => {
      const location = useLocation();
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
                  <Link to="/faq" state={{ from: location.pathname }}>
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