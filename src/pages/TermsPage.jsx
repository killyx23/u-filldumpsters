import React from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import BackButton from '@/components/BackButton';
import { SmsDisclosure } from '@/components/SmsOptInFields';

export const TermsPage = () => {
  return (
    <>
      <Helmet>
        <title>Terms - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Terms for U-Fill Dumpsters LLC rentals and text-message notices, including how to opt out."
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
            <h1 className="text-4xl sm:text-5xl font-bold text-yellow-400 tracking-tight">Terms</h1>
            <p className="mt-4 text-blue-200">U-Fill Dumpsters LLC · Last updated October 1, 2026</p>
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

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Text messages</h2>
              <p>
                Text messages are optional and separate from email. At booking, next to the phone number, there are
                two unchecked boxes: one for transactional order texts and one for marketing texts. Neither is
                required.
              </p>
              <SmsDisclosure className="text-base sm:text-lg text-blue-100 leading-relaxed" />
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Support</h2>
              <p>
                U-Fill Dumpsters LLC, 227 West Casi Way, Saratoga Springs, Utah 84045. Phone{' '}
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
          </div>
        </motion.div>
      </div>
    </>
  );
};
