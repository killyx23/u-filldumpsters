import React, { useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import BackButton from '@/components/BackButton';
import { HPP_TERMS_PATH } from '@/components/terms/HardwareProtectionPlanTerms';
import { buildTermsSections } from '@/components/terms/buildTermsSections';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';

export const TermsPage = () => {
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const { fee } = useChargesAndFees();
  const bookingTerms = useMemo(
    () =>
      buildTermsSections(fee, {
        disclosureClassName: 'text-base sm:text-lg text-blue-100 leading-relaxed',
      }),
    [fee],
  );

  return (
    <>
      <Helmet>
        <title>Terms and Conditions - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Terms and Conditions for U-Fill Dumpsters LLC rentals, including email, text messages, liability, cancellation, payment, and equipment rules."
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
            <h1 className="text-4xl sm:text-5xl font-bold text-yellow-400 tracking-tight">Terms and Conditions</h1>
            <p className="mt-4 text-blue-200">U-Fill Dumpsters LLC · Last updated October 22, 2026</p>
          </header>

          <div className="space-y-8 text-base sm:text-lg text-blue-100 leading-relaxed">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Who we are</h2>
              <p>
                U-Fill Dumpsters LLC rents compact dumpsters and related equipment for residential and commercial
                projects. Bookings are made at{' '}
                <a href="https://u-filldumpsters.com" className="text-yellow-300 hover:text-yellow-200 underline">
                  u-filldumpsters.com
                </a>
                . The rental agreement you accept during checkout governs that specific rental, including scheduling,
                charges, and equipment responsibility.
              </p>
            </section>

            {bookingTerms.map((section) => (
              <section key={section.id} className="space-y-4">
                <h2 className="text-2xl font-bold text-yellow-400">{section.title}</h2>
                <p className="text-blue-200">{section.summary}</p>
                <div className="space-y-4">{section.content}</div>
              </section>
            ))}

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Support</h2>
              <p>
                U-Fill Dumpsters LLC. Phone{' '}
                <a href="tel:+18018108832" className="text-yellow-300 hover:text-yellow-200 underline">
                  (801) 810-8832
                </a>
                . Email{' '}
                <a href="mailto:support@u-filldumpsters.com" className="text-yellow-300 hover:text-yellow-200 underline">
                  support@u-filldumpsters.com
                </a>
                .
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Legal</h2>
              <p>
                The rental agreement accepted during checkout includes the optional{' '}
                <Link to={HPP_TERMS_PATH} className="text-yellow-300 hover:text-yellow-200 underline">
                  Hardware Protection Plan
                </Link>
                . See also the{' '}
                <Link to="/privacy" state={returnTo ? { returnTo } : undefined} className="text-yellow-300 hover:text-yellow-200 underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </section>
          </div>
        </motion.div>
      </div>
    </>
  );
};
