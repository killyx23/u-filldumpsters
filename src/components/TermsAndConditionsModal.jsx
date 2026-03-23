
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TermSection = ({ id, title, summary, content, isExpanded, onToggle, isAccepted, onAcceptChange }) => {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden transition-colors hover:border-white/20">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex-1 pr-4">
          <h4 className="text-lg font-bold text-white mb-1">{title}</h4>
          <p className="text-sm text-gray-400">{summary}</p>
        </div>
        <div className="flex items-center space-x-4">
          {isExpanded ? <ChevronUp className="text-gray-400" /> : <ChevronDown className="text-gray-400" />}
        </div>
      </div>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="border-t border-white/10"
          >
            <div className="p-4 bg-black/20 text-sm text-gray-300 leading-relaxed space-y-3">
              {content}
            </div>
            <div className="p-4 bg-white/5 border-t border-white/10 flex items-center space-x-3">
              <Checkbox 
                id={`term-${id}`} 
                checked={isAccepted} 
                onCheckedChange={onAcceptChange}
                className="border-yellow-500 data-[state=checked]:bg-yellow-500 h-5 w-5"
              />
              <label htmlFor={`term-${id}`} className="text-sm font-bold text-yellow-400 cursor-pointer select-none">
                I have read and explicitly accept the {title}
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const TermsAndConditionsModal = ({ open, onAccept, onDecline }) => {
  const [expandedSection, setExpandedSection] = useState(null);
  const [agreements, setAgreements] = useState({
    email: false,
    liability: false,
    general: false,
    payment: false,
    equipment: false
  });

  const allAccepted = Object.values(agreements).every(v => v === true);

  const toggleAgreement = (key) => {
    setAgreements(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleExpand = (id) => {
    setExpandedSection(expandedSection === id ? null : id);
  };

  const termsData = [
    {
      id: 'email',
      title: 'Email Verification & Communication',
      summary: 'Consent to email communication and verification requirements.',
      content: (
        <>
          <p>I understand that I must verify my email address to complete this booking. All order confirmations, receipts, and critical updates will be sent to this email.</p>
          <p>U-Fill Dumpsters LLC may use this email to communicate regarding scheduling, delays, or issues with the rental. Your contact information will not be sold to third parties.</p>
        </>
      )
    },
    {
      id: 'liability',
      title: 'Liability & Damage Responsibility',
      summary: 'Responsibility for equipment and property damage during rental.',
      content: (
        <>
          <p>Customer assumes all risk of loss, theft, damage, or injury associated with the Equipment during the Rental Period, except to the extent caused by Company's gross negligence or willful misconduct.</p>
          <p>Customer is responsible for repair or replacement costs for any damage to Equipment beyond normal wear and tear. U-Fill Dumpsters is not liable for damage to driveways, lawns, or property resulting from standard delivery and usage of the equipment, unless Driveway Protection was explicitly purchased and utilized.</p>
        </>
      )
    },
    {
      id: 'general',
      title: 'General Terms & Cancellation Policy',
      summary: 'Cancellation fees, refunds, and general rental conditions.',
      content: (
        <>
          <p><strong>Cancellations more than 24 hours before scheduled delivery:</strong> 10% cancellation fee of the order total retained; balance refunded.</p>
          <p><strong>Cancellations 24 hours or less before scheduled delivery:</strong> Up to 50% of the order total charged, plus a 10% cancellation fee of the order total retained.</p>
          <p>No-shows or refusal of equipment at delivery may result in full rental charges. Refunds are processed within one to two business days and should reflect in accounts within 5–10 business days.</p>
        </>
      )
    },
    {
      id: 'payment',
      title: 'Payment Terms & Pricing',
      summary: 'Overweight fees, disposal charges, and payment authorization.',
      content: (
        <>
          <p>Full payment, including taxes and applicable add-ons, is due at booking to secure the reservation.</p>
          <p>Base rental price includes delivery and pickup. <strong>Disposal is billed separately at $45.00 per ton</strong> based on actual post-disposal scale weight.</p>
          <p>Customer authorizes U-Fill Dumpsters LLC to charge the payment method on file for all disposal charges, overweight fees ($100 per ton over limit), damages, fines, and dry run fees (50% of service cost).</p>
        </>
      )
    },
    {
      id: 'equipment',
      title: 'Equipment Care & Usage',
      summary: 'Prohibited materials, loading rules, and weight limits.',
      content: (
        <>
          <p><strong>Weight Limits:</strong> Dumpsters (2.5 tons), Trailers (5 tons). Do not exceed the marked Fill Line. Dirt/soil loads must not exceed halfway up trailer walls.</p>
          <p><strong>Prohibited Materials:</strong> Hazardous materials, paints, solvents, chemicals, asbestos, oils, liquids, medical waste, explosives, tires (unless approved), batteries, refrigerators with Freon, and contaminated soils are strictly prohibited.</p>
          <p>Discovery of prohibited items will result in immediate termination of rental, remediation at Customer's expense, and potential reporting to authorities.</p>
        </>
      )
    }
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && !allAccepted) onDecline();
    }}>
      <DialogContent className="max-w-3xl bg-gray-900 border-gray-700 text-white max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-gray-800 bg-gray-900 z-10">
          <DialogTitle className="flex items-center text-2xl font-bold text-yellow-400">
            <FileText className="mr-3 h-6 w-6" />
            Terms & Conditions Required
          </DialogTitle>
          <DialogDescription className="text-gray-400 pt-2">
            Please expand each section, read carefully, and explicitly accept all critical terms to continue.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-grow p-6 h-full overflow-y-auto">
          <div className="space-y-4">
            {termsData.map((term) => (
              <TermSection
                key={term.id}
                id={term.id}
                title={term.title}
                summary={term.summary}
                content={term.content}
                isExpanded={expandedSection === term.id}
                onToggle={() => handleToggleExpand(term.id)}
                isAccepted={agreements[term.id]}
                onAcceptChange={() => toggleAgreement(term.id)}
              />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 border-t border-gray-800 bg-gray-900 z-10 flex flex-col sm:flex-row gap-4 sm:justify-between items-center">
          <p className="text-sm text-gray-400">
            {Object.values(agreements).filter(Boolean).length} of {termsData.length} sections accepted.
          </p>
          <div className="flex gap-3 w-full sm:w-auto">
            <Button variant="outline" onClick={onDecline} className="w-full sm:w-auto bg-transparent border-gray-600 text-gray-300 hover:text-white hover:bg-gray-800">
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (allAccepted) onAccept();
              }} 
              disabled={!allAccepted}
              className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-black font-bold disabled:opacity-50 transition-all duration-300"
            >
              <CheckCircle2 className="mr-2 h-5 w-5" />
              Accept All & Continue
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
