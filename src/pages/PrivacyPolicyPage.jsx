import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import BackButton from '@/components/BackButton';
import { SmsDisclosure } from '@/components/SmsOptInFields';

export const PrivacyPolicyPage = () => {
  return (
    <>
      <Helmet>
        <title>Privacy Policy - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="How U-Fill Dumpsters LLC collects, uses, and protects customer information, including phone numbers and text-message consent."
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
            <h1 className="text-4xl sm:text-5xl font-bold text-yellow-400 tracking-tight">Privacy Policy</h1>
            <p className="mt-4 text-blue-200">U-Fill Dumpsters LLC · Last updated October 1, 2026</p>
          </header>

          <div className="space-y-8 text-base sm:text-lg text-blue-100 leading-relaxed">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Information we collect</h2>
              <p>
                When you book a rental, create an account, or contact us, we collect the details needed to provide
                the service. That includes your name, email address, mobile phone number, delivery address, booking
                and payment details, and messages you send us.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">How we use it</h2>
              <p>
                We use this information to schedule and complete rentals, send booking confirmations, receipts,
                access codes, pickup and delivery updates, and other account notices by email, phone, or text message.
                We also use it for customer service and our own direct communications about U-Fill Dumpsters.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Sharing</h2>
              <p>
                We do not sell, rent, lease, trade, or distribute your personal data, contact information, phone
                numbers, or email addresses to third-party marketing companies, brokers, or data brokers. Information
                is used for our internal operations, customer service, and direct communications.
              </p>
              <p>
                All the above categories exclude text messaging originator opt-in data and consent; this information
                won&apos;t be shared with any third parties.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Text messages</h2>
              <p>
                Text consent is separate from email. Transactional order texts and marketing texts each have their
                own optional checkbox next to the phone number. Neither box is required or pre-checked.
              </p>
              <SmsDisclosure className="text-base sm:text-lg text-blue-100 leading-relaxed" />
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Contact</h2>
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

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-yellow-400">Legal</h2>
              <p>
                <Link to="/terms" className="text-yellow-300 hover:text-yellow-200 underline">
                  Terms
                </Link>
              </p>
            </section>
          </div>
        </motion.div>
      </div>
    </>
  );
};
