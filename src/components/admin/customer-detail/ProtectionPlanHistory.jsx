import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO } from 'date-fns';
import { Loader2, Shield, AlertTriangle, Plus, Pencil, CreditCard, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';
import { StatusBadge } from '@/components/StatusBadge';
import { resolveCustomerUploadSignedUrl } from '@/utils/verificationImageHelper';

const PROOF_BUCKET = 'customer-uploads';
const HARDWARE_CAP_KEY = 'hardware_protection_plan_cap';
const UNFINISHED_ORDER_STATUSES = new Set(['pending_payment', 'booking_not_finished']);
const CLAIM_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'paid', label: 'Paid' },
];
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const emptyClaimForm = () => ({
  claim_date: new Date().toISOString().split('T')[0],
  claim_amount: '',
  description: '',
  status: 'open',
  admin_notes: '',
});

const planTypeLabel = (planType) =>
  planType === 'driveway_protection' ? 'Driveway Protection' : 'Rental Insurance';

const appliesHardwareCap = (planType) => planType === 'rental_insurance';

const isPlanCancelled = (record) => Boolean(record?.cancelled_at);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const money = (value) => `$${roundMoney(value).toFixed(2)}`;

const bookingStatusOf = (record) => {
  const booking = record?.bookings;
  if (Array.isArray(booking)) return booking[0]?.status || '';
  return booking?.status || '';
};

const isOrderUnfinished = (record) => {
  const status = String(bookingStatusOf(record) || '').toLowerCase();
  if (!status) return true;
  return UNFINISHED_ORDER_STATUSES.has(status);
};

const coverageBadge = (record) => {
  if (isPlanCancelled(record)) {
    return { label: 'Cancelled', className: 'bg-red-900/40 text-red-300' };
  }
  if (record.election !== 'accept') {
    return { label: 'Declined', className: 'bg-gray-800 text-gray-300' };
  }
  if (isOrderUnfinished(record)) {
    return { label: 'Pending', className: 'bg-amber-900/40 text-amber-200' };
  }
  return { label: 'Accepted', className: 'bg-green-900/40 text-green-300' };
};

const coverageIsActive = (record) =>
  record.election === 'accept' && !isPlanCancelled(record) && !isOrderUnfinished(record);

const splitClaimAmount = (amount, cap, planType) => {
  const claimAmount = roundMoney(amount);
  if (!appliesHardwareCap(planType)) {
    return {
      coverageCap: null,
      coveredAmount: claimAmount,
      customerChargeAmount: 0,
    };
  }
  const coverageCap = roundMoney(cap);
  return {
    coverageCap,
    coveredAmount: roundMoney(Math.min(claimAmount, coverageCap)),
    customerChargeAmount: roundMoney(Math.max(0, claimAmount - coverageCap)),
  };
};

const savedFinancials = (claim, cap, planType) => {
  if (!appliesHardwareCap(planType)) return null;
  const hasSnapshot = claim?.coverage_cap != null || claim?.customer_charge_amount != null;
  const split = hasSnapshot
    ? {
        coverageCap: roundMoney(claim.coverage_cap),
        coveredAmount: roundMoney(claim.covered_amount),
        customerChargeAmount: roundMoney(claim.customer_charge_amount),
      }
    : splitClaimAmount(claim?.claim_amount, cap, planType);
  const amountCharged = roundMoney(claim?.amount_charged);
  return {
    ...split,
    amountCharged,
    remaining: roundMoney(Math.max(0, split.customerChargeAmount - amountCharged)),
  };
};

const chargeSummary = (claim, financials) => {
  if (!financials) return null;
  if (financials.amountCharged > 0 && financials.remaining <= 0) {
    return `Card charged ${money(financials.amountCharged)}`;
  }
  if (financials.amountCharged > 0) {
    return `Card charged ${money(financials.amountCharged)}; ${money(financials.remaining)} still owed`;
  }
  if (claim?.charge_status === 'failed') return 'Card charge failed';
  if (financials.remaining > 0) return `${money(financials.remaining)} not charged`;
  return 'Within credit cap';
};

const normalizePhotos = (photos) => (Array.isArray(photos) ? photos.filter((photo) => photo?.path) : []);

async function readFunctionError(error) {
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
    } catch {
      // Fall through to the generic message.
    }
  }
  return error?.message || 'Charge failed';
}

async function uploadProofPhotos(customerId, claimId, files) {
  const uploaded = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo';
    const filePath = `customers/${customerId}/protection-claims/${claimId}/${Date.now()}-${index}-${safeName}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(filePath, file);
    if (error) throw error;
    uploaded.push({ path: filePath, name: file.name });
  }
  return uploaded;
}

const ClaimPhotoThumb = ({ photo, file, onRemove }) => {
  const [url, setUrl] = useState(null);
  const photoPath = photo?.path || '';
  const photoName = photo?.name || 'Claim proof';

  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (!photoPath) return undefined;
    let active = true;
    resolveCustomerUploadSignedUrl({ path: photoPath, name: photoName }).then((signed) => {
      if (active && signed) setUrl(signed);
    });
    return () => {
      active = false;
    };
  }, [file, photoPath, photoName]);

  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-white/15 bg-black/30">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={photoName} className="h-full w-full object-cover" />
        </a>
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-gray-400">Photo</div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white"
          aria-label={`Remove ${photoName}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export const ProtectionPlanHistory = ({ customerId }) => {
  const { user } = useAuth();
  const { fee, getFeeMeta } = useChargesAndFees();
  const [records, setRecords] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editingClaim, setEditingClaim] = useState(null);
  const [claimForm, setClaimForm] = useState(emptyClaimForm);
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [chargingId, setChargingId] = useState(null);
  const editingClaimRef = useRef(null);

  const hardwareCap = Number(fee(HARDWARE_CAP_KEY)) || 0;
  const hardwareCapMeta = getFeeMeta(HARDWARE_CAP_KEY);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!customerId) return;
    if (!silent) setLoading(true);
    try {
      const { data: planRows, error: planError } = await supabase
        .from('booking_protection_plans')
        .select('*, bookings(status)')
        .eq('customer_id', customerId)
        .order('elected_at', { ascending: false });

      if (planError) throw planError;

      const { data: claimRows, error: claimError } = await supabase
        .from('protection_plan_claims')
        .select('*')
        .eq('customer_id', customerId)
        .order('claim_date', { ascending: false });

      if (claimError) throw claimError;

      setRecords(planRows || []);
      setClaims(claimRows || []);
    } catch (error) {
      console.error('[ProtectionPlanHistory] load error:', error);
      toast({
        title: 'Failed to load protection plan history',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const liveSplit = useMemo(
    () => splitClaimAmount(claimForm.claim_amount, hardwareCap, selectedRecord?.plan_type),
    [claimForm.claim_amount, hardwareCap, selectedRecord?.plan_type],
  );

  const amountAlreadyCharged = roundMoney(editingClaim?.amount_charged);
  const remainingToCharge = roundMoney(Math.max(0, liveSplit.customerChargeAmount - amountAlreadyCharged));
  const showCapBreakdown = appliesHardwareCap(selectedRecord?.plan_type);

  const resetDialog = () => {
    setClaimDialogOpen(false);
    setSelectedRecord(null);
    setEditingClaim(null);
    setClaimForm(emptyClaimForm());
    setExistingPhotos([]);
    setPendingFiles([]);
    editingClaimRef.current = null;
  };

  const openClaimDialog = (record, claim = null) => {
    if (!claim && !coverageIsActive(record)) {
      toast({
        title: isOrderUnfinished(record) ? 'Order not completed' : 'No active plan',
        description: isOrderUnfinished(record)
          ? 'Protection stays pending until this order is actually completed.'
          : 'Claims can only be filed against an accepted protection plan on a completed order.',
        variant: 'destructive',
      });
      return;
    }
    setSelectedRecord(record);
    setEditingClaim(claim);
    editingClaimRef.current = claim;
    setClaimForm(claim ? {
      claim_date: claim.claim_date || emptyClaimForm().claim_date,
      claim_amount: claim.claim_amount == null ? '' : String(claim.claim_amount),
      description: claim.description || '',
      status: claim.status || 'open',
      admin_notes: claim.admin_notes || '',
    } : emptyClaimForm());
    setExistingPhotos(normalizePhotos(claim?.proof_photos));
    setPendingFiles([]);
    setClaimDialogOpen(true);
  };

  const handlePhotoPick = (event) => {
    const picked = Array.from(event.target.files || []);
    const images = picked.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type) || file.type.startsWith('image/'));
    if (images.length !== picked.length) {
      toast({
        title: 'Some files were skipped',
        description: 'Claim proof must be an image.',
        variant: 'destructive',
      });
    }
    if (images.length) setPendingFiles((prev) => [...prev, ...images]);
    event.target.value = '';
  };

  const persistClaim = async () => {
    if (!selectedRecord) return null;
    const claimAmount = roundMoney(claimForm.claim_amount);
    if (!claimForm.claim_date || Number.isNaN(claimAmount) || claimAmount < 0) {
      throw new Error('Enter a claim date and an amount of zero or more.');
    }

    const split = splitClaimAmount(claimAmount, hardwareCap, selectedRecord.plan_type);
    const payload = {
      claim_date: claimForm.claim_date,
      claim_amount: claimAmount,
      description: claimForm.description || null,
      status: claimForm.status || 'open',
      admin_notes: claimForm.admin_notes || null,
      coverage_cap: split.coverageCap,
      covered_amount: split.coveredAmount,
      customer_charge_amount: split.customerChargeAmount,
      updated_at: new Date().toISOString(),
    };

    let claimId = editingClaimRef.current?.id;
    if (claimId) {
      const { error } = await supabase
        .from('protection_plan_claims')
        .update(payload)
        .eq('id', claimId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('protection_plan_claims')
        .insert([{
          ...payload,
          booking_protection_plan_id: selectedRecord.id,
          booking_id: selectedRecord.booking_id,
          customer_id: selectedRecord.customer_id,
          created_by: user?.id || null,
        }])
        .select('*')
        .single();
      if (error) throw error;
      claimId = data.id;
      editingClaimRef.current = data;
      setEditingClaim(data);
    }

    const uploaded = pendingFiles.length
      ? await uploadProofPhotos(selectedRecord.customer_id, claimId, pendingFiles)
      : [];
    const removedPaths = normalizePhotos(editingClaimRef.current?.proof_photos)
      .map((photo) => photo.path)
      .filter((path) => !existingPhotos.some((photo) => photo.path === path));
    if (removedPaths.length) {
      const { error: removeError } = await supabase.storage.from(PROOF_BUCKET).remove(removedPaths);
      if (removeError) throw removeError;
    }

    const proofPhotos = [...existingPhotos.map(({ path, name }) => ({ path, name })), ...uploaded];
    const { data: saved, error: photoError } = await supabase
      .from('protection_plan_claims')
      .update({ proof_photos: proofPhotos, updated_at: new Date().toISOString() })
      .eq('id', claimId)
      .select('*')
      .single();
    if (photoError) throw photoError;
    editingClaimRef.current = saved;
    setEditingClaim(saved);
    setExistingPhotos(normalizePhotos(saved.proof_photos));
    setPendingFiles([]);
    return saved;
  };

  const handleSaveClaim = async () => {
    setSaving(true);
    try {
      await persistClaim();
      toast({ title: editingClaim ? 'Claim updated' : 'Claim recorded successfully' });
      resetDialog();
      loadData({ silent: true });
    } catch (error) {
      toast({
        title: 'Failed to save claim',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const chargeClaim = async (claim) => {
    const plan = records.find((record) => record.id === claim.booking_protection_plan_id);
    const financials = savedFinancials(claim, hardwareCap, plan?.plan_type || selectedRecord?.plan_type);
    if (!financials || financials.remaining <= 0) return claim;
    setChargingId(claim.id);
    let chargeData = null;
    try {
      const description = `Hardware protection claim #${claim.id} excess over ${hardwareCapMeta.fee_name} for order #${claim.booking_id}`;
      const { data, error } = await supabase.functions.invoke('charge-customer', {
        body: {
          customerId: claim.customer_id,
          amount: financials.remaining,
          description,
          bookingId: claim.booking_id,
          feeType: `protection_claim_excess_${claim.id}`,
        },
      });
      if (error) throw new Error(await readFunctionError(error));
      if (data?.error) throw new Error(data.error);
      chargeData = data;
    } catch (error) {
      await supabase
        .from('protection_plan_claims')
        .update({
          charge_status: roundMoney(claim.amount_charged) > 0 ? 'charged' : 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', claim.id);
      toast({
        title: 'Charging failed',
        description: error.message,
        variant: 'destructive',
      });
      setChargingId(null);
      return null;
    }

    try {
      const { data: updated, error: updateError } = await supabase
        .from('protection_plan_claims')
        .update({
          amount_charged: roundMoney(financials.amountCharged + financials.remaining),
          charge_status: 'charged',
          stripe_charge_id: chargeData?.latestCharge || null,
          stripe_payment_intent_id: chargeData?.paymentIntentId || null,
          stripe_invoice_id: chargeData?.invoiceId || null,
          charged_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', claim.id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      toast({ title: 'Card charged', description: chargeData?.message || `Charged ${money(financials.remaining)}.` });
      return updated;
    } catch (error) {
      toast({
        title: 'Card charged, claim record did not update',
        description: `${error.message} Do not charge this amount again until you confirm the card charge.`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setChargingId(null);
    }
  };

  const handleChargeFromDialog = async () => {
    setSaving(true);
    try {
      const saved = await persistClaim();
      setSaving(false);
      const charged = await chargeClaim(saved);
      if (charged) {
        resetDialog();
      }
      loadData({ silent: true });
    } catch (error) {
      toast({
        title: 'Failed to save claim',
        description: error.message,
        variant: 'destructive',
      });
      setSaving(false);
    }
  };

  const handleChargeSavedClaim = async (claim) => {
    await chargeClaim(claim);
    loadData({ silent: true });
  };

  const claimsForRecord = (recordId) =>
    claims.filter((claim) => claim.booking_protection_plan_id === recordId);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-purple-400" />
        <h3 className="text-xl font-bold text-white">Protection Plan History</h3>
      </div>

      {records.length === 0 ? (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="py-10 text-center text-gray-400">
            No protection plan records found for this customer.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {records.map((record) => {
            const recordClaims = claimsForRecord(record.id);
            const usedClaim = recordClaims.length > 0;
            const cancelled = isPlanCancelled(record);
            const badge = coverageBadge(record);
            const orderStatus = bookingStatusOf(record);
            const activeCoverage = coverageIsActive(record);
            return (
              <Card key={record.id} className="bg-white/5 border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-white text-lg flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Order #{record.booking_id} — {record.plan_name_snapshot}
                    </span>
                    <span className={`text-sm px-2 py-1 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-blue-100">
                    <p><span className="text-gray-400">Type:</span> {planTypeLabel(record.plan_type)}</p>
                    <p><span className="text-gray-400">Amount:</span> {money(record.price_applied)}</p>
                    <p><span className="text-gray-400">Date/Time:</span> {format(parseISO(record.elected_at), 'PPP p')}</p>
                    <p><span className="text-gray-400">Service ID:</span> {record.service_id_at_purchase ?? 'N/A'}</p>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-400">Order status:</span>
                      {orderStatus ? <StatusBadge status={orderStatus} /> : <span>Unknown</span>}
                    </p>
                    {cancelled && (
                      <p className="md:col-span-2">
                        <span className="text-gray-400">Cancelled:</span>{' '}
                        {format(parseISO(record.cancelled_at), 'PPP p')}
                        {record.election === 'accept' ? ' (was accepted before cancellation)' : ''}
                        {record.cancellation_reason ? ` — ${record.cancellation_reason}` : ''}
                      </p>
                    )}
                  </div>

                  {badge.label === 'Pending' && (
                    <p className="text-amber-200">
                      Customer selected this plan, but the order was not completed. It is not active coverage.
                    </p>
                  )}

                  {usedClaim && (
                    <div className="bg-orange-900/20 border border-orange-500/30 rounded-md p-3 space-y-3">
                      <p className="text-orange-300 font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Claim Used ({recordClaims.length})
                      </p>
                      {recordClaims.map((claim) => {
                        const financials = savedFinancials(claim, hardwareCap, record.plan_type);
                        const photos = normalizePhotos(claim.proof_photos);
                        return (
                          <div key={claim.id} className="rounded-md border border-orange-500/20 bg-black/20 p-3 space-y-2 text-orange-100">
                            <p>
                              {format(parseISO(`${claim.claim_date}T12:00:00`), 'PPP')} — {money(claim.claim_amount)} ({claim.status})
                              {claim.description ? ` — ${claim.description}` : ''}
                            </p>
                            {financials && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
                                <p><span className="text-orange-300/80">Credit cap:</span> {money(financials.coverageCap)}</p>
                                <p><span className="text-orange-300/80">Covered:</span> {money(financials.coveredAmount)}</p>
                                <p><span className="text-orange-300/80">Customer owes:</span> {money(financials.customerChargeAmount)}</p>
                                <p><span className="text-orange-300/80">Card:</span> {chargeSummary(claim, financials)}</p>
                              </div>
                            )}
                            {photos.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {photos.map((photo) => (
                                  <ClaimPhotoThumb key={photo.path} photo={photo} />
                                ))}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-orange-400 text-orange-100 hover:bg-orange-900/30"
                                onClick={() => openClaimDialog(record, claim)}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit claim
                              </Button>
                              {financials && financials.remaining > 0 && (
                                <Button
                                  size="sm"
                                  className="bg-yellow-500 text-black hover:bg-yellow-400"
                                  disabled={chargingId === claim.id}
                                  onClick={() => handleChargeSavedClaim(claim)}
                                >
                                  {chargingId === claim.id ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <CreditCard className="h-4 w-4 mr-2" />
                                  )}
                                  Charge {money(financials.remaining)}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeCoverage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-purple-500 text-purple-300 hover:bg-purple-900/20"
                      onClick={() => openClaimDialog(record)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Log Claim
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={claimDialogOpen} onOpenChange={(open) => { if (!open) resetDialog(); }}>
        <DialogContent className="bg-gray-900 border-yellow-400 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingClaim ? 'Edit Claim' : 'Log Claim'} — Order #{selectedRecord?.booking_id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-white">Claim Date</Label>
              <Input
                type="date"
                value={claimForm.claim_date}
                onChange={(e) => setClaimForm({ ...claimForm, claim_date: e.target.value })}
                className="bg-gray-800 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-white">Claim Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={claimForm.claim_amount}
                onChange={(e) => setClaimForm({ ...claimForm, claim_amount: e.target.value })}
                className="bg-gray-800 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-white">Status</Label>
              <Select
                value={claimForm.status}
                onValueChange={(status) => setClaimForm({ ...claimForm, status })}
              >
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAIM_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showCapBreakdown && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm space-y-1">
                <p className="font-semibold text-yellow-200">{hardwareCapMeta.fee_name}</p>
                <p><span className="text-gray-300">Current cap:</span> {money(hardwareCap)}</p>
                <p><span className="text-gray-300">Covered by plan:</span> {money(liveSplit.coveredAmount)}</p>
                <p><span className="text-gray-300">Customer owes:</span> {money(liveSplit.customerChargeAmount)}</p>
                {amountAlreadyCharged > 0 && (
                  <p><span className="text-gray-300">Already charged:</span> {money(amountAlreadyCharged)}</p>
                )}
                {remainingToCharge > 0 && (
                  <p><span className="text-gray-300">Still to charge:</span> {money(remainingToCharge)}</p>
                )}
              </div>
            )}
            <div>
              <Label className="text-white">Description</Label>
              <Textarea
                value={claimForm.description}
                onChange={(e) => setClaimForm({ ...claimForm, description: e.target.value })}
                className="bg-gray-800 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-white">Admin Notes</Label>
              <Textarea
                value={claimForm.admin_notes}
                onChange={(e) => setClaimForm({ ...claimForm, admin_notes: e.target.value })}
                className="bg-gray-800 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white">Proof photos</Label>
              <div className="flex flex-wrap gap-2">
                {existingPhotos.map((photo) => (
                  <ClaimPhotoThumb
                    key={photo.path}
                    photo={photo}
                    onRemove={() => setExistingPhotos((prev) => prev.filter((item) => item.path !== photo.path))}
                  />
                ))}
                {pendingFiles.map((file, index) => (
                  <ClaimPhotoThumb
                    key={`${file.name}-${file.lastModified}-${file.size}-${index}`}
                    file={file}
                    photo={{ name: file.name }}
                    onRemove={() => setPendingFiles((prev) => prev.filter((item) => item !== file))}
                  />
                ))}
              </div>
              <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-white/30 px-3 py-2 text-sm text-blue-100">
                <ImagePlus className="h-4 w-4" />
                Add pictures
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoPick}
                />
              </Label>
              <p className="text-xs text-gray-400">Saved on this customer file with the claim.</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={resetDialog} disabled={saving || chargingId}>Cancel</Button>
            {showCapBreakdown && remainingToCharge > 0 && (
              <Button
                onClick={handleChargeFromDialog}
                disabled={saving || chargingId}
                className="bg-yellow-500 text-black hover:bg-yellow-400"
              >
                {chargingId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Charge {money(remainingToCharge)}
              </Button>
            )}
            <Button onClick={handleSaveClaim} disabled={saving || chargingId} className="bg-purple-600 hover:bg-purple-700">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
