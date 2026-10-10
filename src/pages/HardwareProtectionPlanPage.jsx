import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import BackButton from '@/components/BackButton';
import { HardwareProtectionPlanTerms } from '@/components/terms/HardwareProtectionPlanTerms';
import { useHppTermsFee } from '@/hooks/useHppTermsFee';

export const HardwareProtectionPlanPage = () => {
  const { fee } = useHppTermsFee();

  return (
    <>
      <Helmet>
        <title>Hardware Protection Plan - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Optional Hardware Protection Plan terms for U-Fill Dumpsters LLC premium Sure-Trac equipment rentals."
        />
      </Helmet>
      <div className="relative">
        <BackButton className="absolute top-4 left-4 z-20" />
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="container mx-auto max-w-3xl py-16 px-4"
        >
          <header className="mb-10">
            <h1 className="text-4xl sm:text-5xl font-bold text-yellow-400 tracking-tight">
              Hardware Protection Plan
            </h1>
            <p className="mt-4 text-blue-200">
              U-Fill Dumpsters LLC · Section 9 of the Master Rental and Service Agreement
            </p>
          </header>

          <div className="space-y-6 text-base sm:text-lg text-blue-100 leading-relaxed">
            <p>
              These terms are part of the Master Rental and Service Agreement accepted at booking. Dollar amounts
              follow the current admin pricing for the Hardware Protection Plan and related replacement fees.
            </p>
            <HardwareProtectionPlanTerms fee={fee} />
            <p>
              See also the{' '}
              <Link to="/privacy" className="text-yellow-300 hover:text-yellow-200 underline">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link to="/terms" className="text-yellow-300 hover:text-yellow-200 underline">
                Terms
              </Link>
              .
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
};
