import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgreementText } from '@/components/ComprehensiveAgreement';
import { SmsOptInFields } from '@/components/SmsOptInFields';
import { HPP_TERMS_PATH } from '@/components/terms/HardwareProtectionPlanTerms';
import { saveCheckoutVerificationDocuments } from '@/utils/verificationImageHelper';
import { DEFAULT_FEES, mapFeeRowsToConfig } from '@/utils/chargesAndFeesConfig';
import { money } from '@/utils/phoneOrderQuote';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';

function continueAfterAccept(redirect, email, pendingId) {
  if (redirect && String(redirect).startsWith('/payment')) {
    markVerifiedEmailSession(email, pendingId);
  }
  if (redirect) window.location.assign(redirect);
}

export function OrderAcceptPage() {
  const { token } = useParams();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [summaryAccepted, setSummaryAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureDate, setSignatureDate] = useState(() => format(new Date(), 'PPP'));
  const [orderTexts, setOrderTexts] = useState(false);
  const [marketingTexts, setMarketingTexts] = useState(false);
  const [licensePlate, setLicensePlate] = useState('');
  const [deferDocuments, setDeferDocuments] = useState(false);
  const [files, setFiles] = useState({ front: null, back: null, insurance: null });
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [hppPlanPrice, setHppPlanPrice] = useState(null);
  const [busy, setBusy] = useState(false);
  const agreementViewportRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke('phone-order-acceptance', { body: { action: 'open', token } })
      .then(async ({ data, error: invokeError }) => {
        if (cancelled) return;
        if (invokeError || data?.error) {
          setError(await parseEdgeFunctionError(invokeError, data));
          return;
        }
        if (data.redirect && (data.alreadyAccepted || data.summary?.status === 'accepted')) {
          continueAfterAccept(data.redirect, data.summary?.email, data.summary?.pendingId);
          return;
        }
        setSummary(data.summary);
        if (data.summary?.savedLicensePlate) {
          setLicensePlate(String(data.summary.savedLicensePlate).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7));
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from('charges_and_fees').select('fee_key, fee_name, fee_description, fee_value, is_percentage').order('fee_name', { ascending: true }),
      supabase.from('protection_plans').select('price').eq('plan_type', 'rental_insurance').eq('is_primary', true).eq('is_active', true).order('display_order', { ascending: true }).limit(1).maybeSingle(),
    ]).then(([feesResult, planResult]) => {
      if (cancelled) return;
      if (!feesResult.error && feesResult.data) {
        setFees((prev) => ({ ...prev, ...mapFeeRowsToConfig(feesResult.data) }));
      }
      if (!planResult.error && planResult.data?.price != null) {
        setHppPlanPrice(Number(planResult.data.price));
      }
    });
    return () => { cancelled = true; };
  }, []);

  const markScrolled = (element) => {
    if (!element) return;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
    const noScrollNeeded = element.scrollHeight <= element.clientHeight + 8;
    if (atBottom || noScrollNeeded) setScrolled(true);
  };

  useEffect(() => {
    const element = agreementViewportRef.current;
    if (!element || !summary) return undefined;
    markScrolled(element);
    return undefined;
  }, [summary, fees]);

  const expectedName = `${summary?.firstName || ''} ${summary?.lastName || ''}`.trim();
  const documentsRequiredNow = summary?.documentsRequiredNow === true;
  const canDeferDocuments = summary?.pickupRequired === true && !documentsRequiredNow;
  const plate = licensePlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const plateValid = /^[A-Z0-9]{6,7}$/.test(plate);
  const filesOnFile = summary?.documentsOnFile === true;
  const filesSelected = Boolean(files.front && files.back && files.insurance);
  const documentsComplete = plateValid && (filesSelected || filesOnFile);
  const documentsReady = !summary?.pickupRequired || (canDeferDocuments && deferDocuments) || documentsComplete;
  const missingDocumentNotes = [];
  if (summary?.pickupRequired && !(canDeferDocuments && deferDocuments) && !documentsComplete) {
    if (!plateValid) missingDocumentNotes.push('a license plate of 6 or 7 letters and numbers');
    if (!filesSelected && !filesOnFile) missingDocumentNotes.push('both sides of the license and proof of insurance');
  }

  const accept = async () => {
    if (!summary) return;
    setBusy(true);
    setError('');
    try {
      if (summary.pickupRequired && documentsRequiredNow && !documentsComplete) {
        throw new Error('This pickup is inside 12 hours. Add the license plate, both sides of the license, and proof of insurance before continuing.');
      }
      if (summary.pickupRequired && !(canDeferDocuments && deferDocuments)) {
        if (!documentsComplete) {
          throw new Error('Add a 6 or 7 character license plate, both sides of the license, and proof of insurance, or agree to add them in the customer portal at least 12 hours before pickup.');
        }
        await saveCheckoutVerificationDocuments({
          customerId: summary.customerId,
          email: summary.email,
          pendingToken: summary.pendingId,
          licensePlate: plate,
          licenseFrontFile: files.front,
          licenseBackFile: files.back,
          insuranceFile: files.insurance,
        });
      }
      const { data, error: invokeError } = await supabase.functions.invoke('phone-order-acceptance', {
        body: {
          action: 'accept',
          token,
          signatureName,
          signatureDate,
          termsAccepted: true,
          summaryAccepted: true,
          smsTransactionalOptIn: orderTexts === true,
          smsMarketingOptIn: marketingTexts === true,
          deferDocuments: canDeferDocuments && deferDocuments,
          documentsComplete: summary.pickupRequired ? documentsComplete : false,
          licensePlate: documentsComplete ? plate : '',
          siteUrl: window.location.origin,
        },
      });
      if (invokeError || data?.error) throw new Error(await parseEdgeFunctionError(invokeError, data));
      if (data.redirect) {
        continueAfterAccept(data.redirect, summary.email, summary.pendingId);
        return;
      }
    } catch (acceptError) {
      setError(acceptError.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !summary) {
    return <div className="mx-auto max-w-lg px-4 py-16 text-center text-white"><p>{error}</p></div>;
  }
  if (!summary) {
    return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div>;
  }

  const nameMatches = signatureName.trim().toLowerCase() === expectedName.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-white">
      <p className="text-xs uppercase tracking-[0.22em] text-yellow-400">U-Fill Dumpsters</p>
      <h1 className="mt-2 text-3xl font-semibold">Confirm your booking</h1>
      <p className="mt-2 text-gray-300">Read the same master agreement used for an online booking, then accept it.</p>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg">{summary.serviceName}</h2>
        <p className="mt-2 text-sm text-gray-300">{summary.dropOff} to {summary.pickup}</p>
        <p className="text-sm text-gray-300">{[summary.street, summary.city, summary.state, summary.zip].filter(Boolean).join(', ')}</p>
        <p className="mt-3 text-2xl text-yellow-300">{money(summary.total)}</p>
        {(summary.lineItems || []).map((line) => (
          <div key={line.key} className="mt-1 flex justify-between text-sm text-gray-300">
            <span>{line.label}</span>
            <span>{money(line.amountAfterDiscount ?? line.amount)}</span>
          </div>
        ))}
      </section>

      <ScrollArea
        className="mt-6 h-[40vh] rounded-2xl border border-white/20 bg-black/20"
        viewportRef={agreementViewportRef}
        viewportProps={{ onScroll: (event) => markScrolled(event.currentTarget) }}
      >
        <div className="p-4 text-sm leading-relaxed text-gray-200">
          <AgreementText fees={fees} hppPlanPrice={hppPlanPrice} />
        </div>
      </ScrollArea>
      {!scrolled && <p className="mt-2 text-xs text-gray-400">Scroll to the bottom of the master agreement to continue.</p>}

      <section className="mt-6 rounded-lg border-2 border-orange-500 bg-orange-50 p-5 text-slate-800">
        <h2 className="font-bold text-orange-700">Important rental terms summary</h2>
        <p className="mt-2 text-sm leading-relaxed">
          By checking this box and completing your booking, you explicitly authorize U-Fill Dumpsters LLC to automatically charge your payment method on file for all rental fees, disposal overages, cleanings, and any equipment damage, loss, or theft. You acknowledge that you are default 100% financially liable for all equipment recovery costs, court fees, administrative labor, and loss-of-use penalties if your payment method is declined or if equipment is returned damaged, overfilled, or violating safety transport laws. You certify that you are at least 18 years of age, fully competent to operate or transport the rented equipment, and agree to the comprehensive terms of the Master Rental and Service Agreement. If any optional insurance, protection, or peace-of-mind coverage is purchased, you remain fully responsible for all amounts that exceed the purchased coverage limits. The full Hardware Protection Plan terms are part of this agreement.
        </p>
        <p className="mt-2 text-sm">
          <a href={HPP_TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Hardware Protection Plan</a>
          {' · '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Privacy Policy</a>
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="mt-1"
            disabled={!scrolled}
            checked={summaryAccepted}
            onChange={(event) => setSummaryAccepted(event.target.checked)}
          />
          I have fully scrolled, read, and explicitly agree to the Important Rental Terms Summary and the complete Master Agreement terms.
        </label>
      </section>

      <section className="mt-6 rounded-lg border border-white/20 bg-black/20 p-4">
        <h2 className="text-lg font-bold text-yellow-300">Representation of operator and absolute liability</h2>
        <div className="mt-2 space-y-3 text-sm text-blue-200">
          <p>
            By executing this agreement, <strong className="text-yellow-300">{expectedName}</strong> expressly warrants that they are the primary authorized operator of the leased equipment.
          </p>
          <p>The identification and documentation provided during checkout belong to them and accurately represent their true identity.</p>
          <p>
            They assume absolute liability for the equipment from the moment of possession until it is returned and accepted. That liability stays in place if someone else transports, loads, dumps, or operates the equipment.
          </p>
        </div>
      </section>

      <label className="mt-6 flex items-start gap-3 text-sm">
        <Checkbox checked={termsAccepted} onCheckedChange={(value) => setTermsAccepted(value === true)} className="mt-0.5 h-6 w-6" />
        By checking this box and typing my name below, I agree that I have read, understood, and legally bind myself to the rental agreement terms above.
      </label>

      {summary.pickupRequired && (
        <section className="mt-6 space-y-3">
          <h2 className="text-lg">Driver documents</h2>
          {documentsRequiredNow ? (
            <p className="text-sm text-amber-200">This pickup is inside 12 hours. The license plate, both sides of the driver license, and proof of insurance have to be added here before the booking can continue.</p>
          ) : (
            <p className="text-sm text-gray-300">Add these now, or agree to add them in the customer portal at least 12 hours before pickup. The confirmation email includes the customer portal login. If they are still missing by that deadline, the booking is reviewed the same way as a missing license, and the usual cancellation fees can apply.</p>
          )}
          {canDeferDocuments && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={deferDocuments} onCheckedChange={(value) => setDeferDocuments(value === true)} />
              I agree to add my license plate, both sides of my driver license, and proof of insurance in the customer portal at least 12 hours before pickup.
            </label>
          )}
          {!(canDeferDocuments && deferDocuments) && (
            <>
              <Label>License plate</Label>
              <Input
                value={licensePlate}
                maxLength={7}
                onChange={(event) => setLicensePlate(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))}
                className="bg-white/10 border-white/30"
              />
              {licensePlate && !plateValid && <p className="text-xs text-red-300">Plate must be 6 or 7 letters and numbers.</p>}
              {filesOnFile && <p className="text-xs text-gray-300">License photos and insurance already saved. You can leave them, or choose new files to replace them.</p>}
              <Label>License, front</Label>
              <Input type="file" accept="image/*,.pdf" onChange={(event) => setFiles((prev) => ({ ...prev, front: event.target.files?.[0] || null }))} />
              <Label>License, back</Label>
              <Input type="file" accept="image/*,.pdf" onChange={(event) => setFiles((prev) => ({ ...prev, back: event.target.files?.[0] || null }))} />
              <Label>Insurance card</Label>
              <Input type="file" accept="image/*,.pdf" onChange={(event) => setFiles((prev) => ({ ...prev, insurance: event.target.files?.[0] || null }))} />
            </>
          )}
        </section>
      )}

      <section className="mt-6 rounded-lg border border-white/10 p-4">
        <h2 className="text-lg">Text messages</h2>
        <p className="mt-1 mb-3 text-sm text-gray-300">Email confirmations are always sent. These two choices are optional and start unchecked.</p>
        <SmsOptInFields
          transactional={orderTexts}
          marketing={marketingTexts}
          onTransactionalChange={setOrderTexts}
          onMarketingChange={setMarketingTexts}
        />
      </section>

      <Label className="mt-6 block">Type your full name: {expectedName}</Label>
      <Input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} className="mt-1 bg-white/10 border-white/30" />
      <Label className="mt-4 block">Date</Label>
      <Input value={signatureDate} onChange={(event) => setSignatureDate(event.target.value)} className="mt-1 bg-white/10 border-white/30" />
      {missingDocumentNotes.length > 0 && (
        <p className="mt-3 text-sm text-amber-200">Still needed: {missingDocumentNotes.join(', and ')}.</p>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <Button
        className="mt-6 w-full bg-yellow-400 text-black hover:bg-yellow-300"
        disabled={busy || !scrolled || !summaryAccepted || !termsAccepted || !signatureDate.trim() || !nameMatches || !documentsReady}
        onClick={accept}
      >
        {busy ? 'Confirming…' : summary.paymentChoice === 'agent_card' ? 'Accept and finish' : 'Accept and continue to payment'}
      </Button>
    </div>
  );
}

export default OrderAcceptPage;
