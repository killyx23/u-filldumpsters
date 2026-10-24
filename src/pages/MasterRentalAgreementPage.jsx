import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { format } from 'date-fns';
import { useReactToPrint } from 'react-to-print';
import { Download } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { isSafeReturnPath } from '@/utils/smsFormReturn';
import { Button } from '@/components/ui/button';
import { AgreementText } from '@/components/ComprehensiveAgreement';
import { supabase } from '@/lib/customSupabaseClient';
import { mapFeeRowsToConfig } from '@/utils/chargesAndFeesConfig';

export const MASTER_RENTAL_AGREEMENT_PATH = '/master-rental-agreement';

const SHEET_STYLES = `
  .rental-doc-sheet, .rental-doc-sheet * {
    color: #111827 !important;
    border-color: #d1d5db !important;
  }
  .rental-doc-sheet {
    background: #ffffff !important;
  }
  .rental-doc-sheet a {
    color: #1d4ed8 !important;
    text-decoration: underline;
  }
`;

export const MasterRentalAgreementPage = () => {
  const printRef = useRef(null);
  const [fees, setFees] = useState(null);
  const [hppPlanPrice, setHppPlanPrice] = useState(null);
  const documentDate = format(new Date(), 'MMMM d, yyyy');

  useEffect(() => {
    let mounted = true;
    Promise.all([
      supabase.from('charges_and_fees').select('fee_key, fee_value'),
      supabase
        .from('protection_plans')
        .select('price')
        .eq('plan_type', 'rental_insurance')
        .eq('is_primary', true)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]).then(([feesResult, planResult]) => {
      if (!mounted) return;
      if (!feesResult.error && feesResult.data) {
        setFees(mapFeeRowsToConfig(feesResult.data));
      } else {
        setFees({});
      }
      if (!planResult.error && planResult.data?.price != null) {
        setHppPlanPrice(Number(planResult.data.price));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `Master Rental Agreement ${documentDate}`,
  });

  return (
    <>
      <Helmet>
        <title>Master Rental Agreement - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Master Rental Agreement for U-Fill Dumpsters LLC, including the charges and fees in effect on the date this document is opened."
        />
      </Helmet>
      <div className="relative">
        <BackButton
          className="absolute top-4 left-4 z-20"
          onBack={({ navigate, location }) => {
            if (location.state?.resumeBooking) {
              const returnTo = isSafeReturnPath(location.state.returnTo) ? location.state.returnTo : '/';
              navigate(returnTo, { state: { resumeDraft: true } });
              return;
            }
            const historyIndex = window.history.state?.idx;
            if (typeof historyIndex === 'number' && historyIndex > 0) {
              navigate(-1);
              return;
            }
            if (isSafeReturnPath(location.state?.returnTo)) {
              navigate(location.state.returnTo);
              return;
            }
            navigate('/');
          }}
        />
        <div className="container mx-auto max-w-3xl py-16 px-4">
          <div className="mb-6 flex justify-end">
            <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700">
              <Download className="w-4 h-4 mr-2" /> Print or save PDF
            </Button>
          </div>
          <div ref={printRef} className="rental-doc-sheet bg-white text-gray-900 p-6 space-y-4 rounded-md">
            <style>{SHEET_STYLES}</style>
            <h1 className="text-2xl font-bold">Master Rental Agreement</h1>
            <p className="text-sm">U-Fill Dumpsters LLC</p>
            <p className="text-sm">
              Document date: {documentDate}. Prices and percentages below are the amounts in effect on this date.
            </p>
            {fees ? (
              <AgreementText fees={fees} hppPlanPrice={hppPlanPrice} strictFees />
            ) : (
              <p>Loading current pricing…</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
