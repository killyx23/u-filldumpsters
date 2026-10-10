import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Download, Eye, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { AgreementText } from '@/components/ComprehensiveAgreement';
import { buildTermsSections } from '@/components/terms/buildTermsSections';
import { HardwareProtectionPlanTerms } from '@/components/terms/HardwareProtectionPlanTerms';
import {
  formatAdminMoney,
  formatAdminPercent,
  HPP_ENROLLMENT_FEE_KEY,
  mapFeeRowsToConfig,
  readAdminFee,
  UNAVAILABLE_FEE_TEXT,
} from '@/utils/chargesAndFeesConfig';
import { buildCustomerDocumentQrUrl } from '@/utils/buildPortalQrUrls';
import {
  customerRentalDocumentFlags,
  filterCustomerRentalDocuments,
  findCustomerRentalDocument,
} from '@/utils/customerRentalDocuments';

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

function latestSignature(bookings, customerData) {
  const sorted = [...(bookings || [])].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
  );
  const signed = sorted.find((booking) => booking?.addons?.agreementSignature);
  const fallbackName = [customerData?.first_name, customerData?.last_name].filter(Boolean).join(' ')
    || customerData?.name
    || '';
  if (signed) {
    return {
      name: signed.addons.agreementSignature,
      date: signed.addons.agreementSignatureDate || null,
    };
  }
  return { name: fallbackName, date: null };
}

function SignatureBlock({ signature }) {
  if (!signature?.name && !signature?.date) return null;
  return (
    <div className="mt-8 border-t border-gray-300 pt-4 text-sm">
      <p className="font-semibold">Electronically signed</p>
      {signature.name ? <p>Signed by {signature.name}</p> : null}
      {signature.date ? <p>Date: {signature.date}</p> : null}
    </div>
  );
}

function AppliesTo({ labels }) {
  if (!labels?.length) return null;
  return (
    <p className="text-sm mb-4">
      <strong>Applies to: </strong>
      {labels.join('; ')}
    </p>
  );
}

function percentText(fee, key) {
  const formatted = formatAdminPercent(fee(key));
  return formatted === UNAVAILABLE_FEE_TEXT ? formatted : `${formatted}%`;
}

function DrivewayTerms({ fee, accepted }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <p>
        Dumpster delivery rentals include an optional Driveway Protection Plan for{' '}
        {formatAdminMoney(fee('driveway_protection_plan_cost'))}. Delivery vehicles and loaded dumpsters are heavy.
        The company is not liable for scuffing, cracking, indentation, or other surface damage to asphalt,
        concrete, pavers, lawns, or landscaping from equipment weight or placement.
      </p>
      <p>
        {accepted
          ? 'You purchased Driveway Protection on at least one dumpster delivery. Coverage follows the plan you accepted at booking.'
          : 'Where Driveway Protection was declined, you accept full responsibility for driveway and surface damage during delivery and pickup.'}
      </p>
    </div>
  );
}

function DeliveryTerms({ fee }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <p>
        For company delivery, the rental begins on delivery and ends on the scheduled pickup. Extensions must be
        requested at least 24 hours before pickup and may include an extension fee of {formatAdminMoney(fee('extension_fee'))}.
      </p>
      <p>
        You must provide a safe placement site on private property unless street placement and any required permits
        were agreed in advance. The site must be clear of overhead obstructions and able to support the equipment
        and delivery vehicle. If a company vehicle becomes stuck because of unstable ground at the requested site,
        you are responsible for towing and recovery costs.
      </p>
      <p>
        If delivery or pickup cannot be completed because of blocked access, parked vehicles, locked gates, unsafe
        conditions, an overfilled container, or missing permits, a dry run fee of{' '}
        {percentText(fee, 'dry_run_percentage')} of the service cost may be charged.
      </p>
    </div>
  );
}

function TowingTerms() {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <p>
        When you tow or transport equipment, you are responsible for inspecting safety chains, the breakaway switch,
        the hitch, lights, and securement before you leave. You agree to follow local, state, and federal transport
        laws. The company is not liable for roadside citations, accidents, or loose cargo during your transport.
      </p>
    </div>
  );
}

function CompactEquipmentTerms() {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <p>
        These terms apply when you rent a mini excavator, mini skid steer, track loader, telescoping loader, or
        similar compact equipment. You confirm the operator is capable of running the machine safely, and that you
        inspected it at pickup and found it operable.
      </p>
      <p>
        Do not allow untrained operators or minors to run the machine, and do not operate it while impaired or
        fatigued. You are responsible for locating and marking underground utilities before you dig or load. The
        company is not liable for damage to underground utilities or structures.
      </p>
    </div>
  );
}

function DocumentBody({ document, bookings, customerData, fees, fee, hppFee, hppPlanPrice }) {
  const flags = customerRentalDocumentFlags(bookings);
  const terms = useMemo(() => buildTermsSections(fee), [fee]);
  const signature = latestSignature(bookings, customerData);

  return (
    <div className="rental-doc-sheet bg-white text-gray-900 p-6 space-y-4">
      <style>{SHEET_STYLES}</style>
      <h1 className="text-2xl font-bold">{document.title}</h1>
      <AppliesTo labels={document.appliesTo} />
      {document.kind === 'master' && (
        <AgreementText fees={fees} hppPlanPrice={hppPlanPrice} strictFees />
      )}
      {document.kind === 'terms' && (
        <div className="space-y-6 text-sm leading-relaxed">
          {terms.map((section) => (
            <section key={section.id} className="space-y-2">
              <h2 className="text-lg font-bold">{section.title}</h2>
              {section.content}
            </section>
          ))}
          {flags.hpp && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Hardware Protection Plan</h2>
              <HardwareProtectionPlanTerms fee={hppFee} linkClassName="underline" />
            </section>
          )}
          {flags.driveway && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Driveway Protection</h2>
              <DrivewayTerms fee={fee} accepted={flags.drivewayAccepted} />
            </section>
          )}
          {flags.delivery && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Delivery and Placement</h2>
              <DeliveryTerms fee={fee} />
            </section>
          )}
          {flags.towing && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Towing and Transport</h2>
              <TowingTerms />
            </section>
          )}
          {flags.compact && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Compact Equipment</h2>
              <CompactEquipmentTerms />
            </section>
          )}
        </div>
      )}
      {document.kind === 'hpp' && <HardwareProtectionPlanTerms fee={hppFee} linkClassName="underline" />}
      {document.kind === 'driveway' && <DrivewayTerms fee={fee} accepted={flags.drivewayAccepted} />}
      {document.kind === 'delivery' && <DeliveryTerms fee={fee} />}
      {document.kind === 'towing' && <TowingTerms />}
      {document.kind === 'compact' && <CompactEquipmentTerms />}
      <SignatureBlock signature={signature} />
    </div>
  );
}

export const CustomerRentalDocuments = ({ bookings = [], customerData = null, searchQuery = '', category = 'All' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [fees, setFees] = useState({});
  const [hppPlanPrice, setHppPlanPrice] = useState(null);
  const printRef = useRef(null);

  const visibleDocuments = useMemo(
    () => filterCustomerRentalDocuments(bookings, { category, searchQuery }),
    [bookings, category, searchQuery],
  );

  const selectedKey = searchParams.get('document');
  const selected = findCustomerRentalDocument(bookings, selectedKey);

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
      }
      if (!planResult.error && planResult.data?.price != null) {
        setHppPlanPrice(Number(planResult.data.price));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const fee = useMemo(() => (key) => readAdminFee(fees, key), [fees]);
  const hppFee = useMemo(
    () => (key) => {
      if (key === HPP_ENROLLMENT_FEE_KEY) {
        if (hppPlanPrice == null || hppPlanPrice === '') return null;
        const amount = Number(hppPlanPrice);
        return Number.isFinite(amount) ? amount : null;
      }
      return readAdminFee(fees, key);
    },
    [fees, hppPlanPrice],
  );

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: selected?.title || 'Rental document',
  });

  const openDocument = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'resources');
    next.set('document', key);
    setSearchParams(next);
  };

  const closeDocument = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('document');
    setSearchParams(next);
  };

  if (!visibleDocuments.length) return null;

  const qrUrl = selected
    ? buildCustomerDocumentQrUrl({
        documentKey: selected.key,
        portalNumber: customerData?.customer_id_text,
        phone: customerData?.phone,
        orderId: selected.orderId,
      })
    : '';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold text-white">Your documents</h3>
        <p className="text-sm text-blue-200">
          Agreements and terms that apply to your rentals. Open one to view it, download a PDF, or scan the QR code.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleDocuments.map((doc) => (
          <button
            key={doc.key}
            type="button"
            onClick={() => openDocument(doc.key)}
            className="text-left bg-black/20 border border-white/10 rounded-xl overflow-hidden hover:bg-white/5 transition-colors group flex flex-col h-full"
          >
            <div className="aspect-video bg-black/40 flex items-center justify-center">
              <FileText className="w-12 h-12 text-gray-500" />
            </div>
            <div className="p-5 flex flex-col flex-grow">
              <div className="flex items-center gap-2 text-xs text-blue-200 mb-2">
                <FileText className="w-3 h-3" />
                Document
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-yellow-400">{doc.title}</h3>
              <p className="text-gray-400 text-sm line-clamp-3 mb-3 flex-grow">{doc.description}</p>
              {doc.appliesTo?.[0] && (
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{doc.appliesTo.join(' · ')}</p>
              )}
              <span className="text-yellow-400 text-sm font-medium inline-flex items-center gap-2">
                <Eye className="w-4 h-4" /> View PDF
              </span>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeDocument(); }}>
        <DialogContent className="max-w-3xl bg-gray-900 border-yellow-400 text-white h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto rounded-md my-2">
            {selected && (
              <div ref={printRef}>
                <DocumentBody
                  document={selected}
                  bookings={bookings}
                  customerData={customerData}
                  fees={fees}
                  fee={fee}
                  hppFee={hppFee}
                  hppPlanPrice={hppPlanPrice}
                />
                <div className="rental-doc-sheet bg-white px-6 pb-6">
                  <style>{SHEET_STYLES}</style>
                  <div className="border-t border-gray-300 pt-4">
                    <p className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
                      <QrCode className="w-4 h-4" /> Scan to open this document
                    </p>
                    <div className="inline-block bg-white p-2">
                      <QRCodeSVG value={qrUrl} size={120} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDocument}>Close</Button>
            <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700">
              <Download className="w-4 h-4 mr-2" /> Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
