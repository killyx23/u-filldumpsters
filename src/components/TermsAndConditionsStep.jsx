
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, FileText, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

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

export const TermsAndConditionsStep = ({ onAccept, onBack }) => {
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
    <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -50 }}
        className="container mx-auto py-16 px-4"
    >
        <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
                    <ArrowLeft />
                </Button>
                <div>
                  <h2 className="text-3xl font-bold text-white flex items-center">
                      <FileText className="mr-3 h-8 w-8 text-yellow-400" />
                      Terms & Conditions
                  </h2>
                  <p className="text-gray-400 mt-1">Please expand each section, read carefully, and explicitly accept all critical terms.</p>
                </div>
            </div>

            <div className="space-y-4 mb-8">
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

            <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-sm text-gray-400">
                    {Object.values(agreements).filter(Boolean).length} of {termsData.length} sections accepted.
                </p>
                <Button 
                    onClick={() => {
                        if (allAccepted) onAccept();
                    }} 
                    disabled={!allAccepted}
                    className="w-full sm:w-auto py-6 px-8 text-lg font-bold bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-900/50 disabled:opacity-50 transition-all duration-300"
                >
                    <CheckCircle2 className="mr-2 h-5 w-5" />
                    Accept All & Continue
                </Button>
            </div>
        </div>
    </motion.div>
  );
};
