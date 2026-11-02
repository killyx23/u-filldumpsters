import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';
import { buildTermsSections } from '@/components/terms/buildTermsSections';

const AGREEMENT_NOTE = 'I have read these and I agree to these terms and conditions by checking here.';

const TermSection = ({ id, title, isAccepted, onAcceptChange, onOpen }) => {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 transition-colors hover:border-white/20">
      <div className="flex items-start gap-3">
        <Checkbox
          id={`term-${id}`}
          checked={isAccepted}
          onCheckedChange={onAcceptChange}
          className="mt-1 border-yellow-500 data-[state=checked]:bg-yellow-500 h-5 w-5"
        />
        <p className="text-lg leading-snug">
          <a
            href={`#terms-${id}`}
            onClick={(event) => {
              event.preventDefault();
              onOpen();
            }}
            className="font-bold text-yellow-400 underline hover:text-yellow-300"
          >
            {title}
          </a>
          <label
            htmlFor={`term-${id}`}
            className="text-sm italic text-gray-300 cursor-pointer"
          >
            {' '}({AGREEMENT_NOTE})
          </label>
        </p>
      </div>
    </div>
  );
};

export const TermsAndConditionsStep = ({ onAccept, onBack }) => {
  const { fee } = useChargesAndFees();
  const [openSectionId, setOpenSectionId] = useState(null);
  const [agreements, setAgreements] = useState({
    email: false,
    liability: false,
    general: false,
    payment: false,
    equipment: false,
  });
  const allAccepted = Object.values(agreements).every((value) => value === true);
  const termsData = useMemo(() => buildTermsSections(fee), [fee]);
  const openTerm = termsData.find((term) => term.id === openSectionId) || null;

  const setAgreement = (key, checked) => {
    setAgreements((prev) => ({
      ...prev,
      [key]: checked === true,
    }));
  };

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
            <p className="text-gray-400 mt-1">
              Open each title to read that section, then check the box to agree.
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          {termsData.map((term) => (
            <TermSection
              key={term.id}
              id={term.id}
              title={term.title}
              isAccepted={agreements[term.id]}
              onAcceptChange={(checked) => setAgreement(term.id, checked)}
              onOpen={() => setOpenSectionId(term.id)}
            />
          ))}
        </div>

        <Dialog open={openTerm != null} onOpenChange={(isOpen) => { if (!isOpen) setOpenSectionId(null); }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-gray-950 border-white/20">
            <DialogHeader>
              <DialogTitle className="text-yellow-400">{openTerm?.title}</DialogTitle>
              {openTerm?.summary ? (
                <DialogDescription className="text-gray-400">{openTerm.summary}</DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="text-sm text-gray-300 leading-relaxed space-y-3">
              {openTerm?.content}
            </div>
          </DialogContent>
        </Dialog>

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
        <UiControlGuide
          stepTitle="Terms & Conditions"
          entries={getBookingGuideEntries('terms')}
          className="mt-3 flex justify-end"
        />
      </div>
    </motion.div>
  );
};
