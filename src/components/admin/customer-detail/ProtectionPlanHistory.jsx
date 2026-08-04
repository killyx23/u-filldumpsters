import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO } from 'date-fns';
import { Loader2, Shield, AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const planTypeLabel = (planType) =>
  planType === 'driveway_protection' ? 'Driveway Protection' : 'Rental Insurance';

const isPlanCancelled = (record) => Boolean(record?.cancelled_at);

const coverageBadge = (record) => {
  if (isPlanCancelled(record)) {
    return { label: 'Cancelled', className: 'bg-red-900/40 text-red-300' };
  }
  if (record.election === 'accept') {
    return { label: 'Accepted', className: 'bg-green-900/40 text-green-300' };
  }
  return { label: 'Declined', className: 'bg-gray-800 text-gray-300' };
};

export const ProtectionPlanHistory = ({ customerId }) => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [claimForm, setClaimForm] = useState({
    claim_date: new Date().toISOString().split('T')[0],
    claim_amount: '',
    description: '',
    status: 'open',
    admin_notes: '',
  });

  const loadData = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const { data: planRows, error: planError } = await supabase
        .from('booking_protection_plans')
        .select('*')
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
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openClaimDialog = (record) => {
    if (isPlanCancelled(record)) {
      toast({
        title: 'Plan cancelled',
        description: 'Claims cannot be filed against a cancelled booking protection plan.',
        variant: 'destructive',
      });
      return;
    }
    if (record.election !== 'accept') {
      toast({
        title: 'No accepted plan',
        description: 'Claims can only be filed against accepted protection plans.',
        variant: 'destructive',
      });
      return;
    }
    setSelectedRecord(record);
    setClaimForm({
      claim_date: new Date().toISOString().split('T')[0],
      claim_amount: '',
      description: '',
      status: 'open',
      admin_notes: '',
    });
    setClaimDialogOpen(true);
  };

  const handleSaveClaim = async () => {
    if (!selectedRecord) return;
    if (isPlanCancelled(selectedRecord)) {
      toast({
        title: 'Plan cancelled',
        description: 'Claims cannot be filed against a cancelled booking protection plan.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const { error } = await supabase.from('protection_plan_claims').insert([{
        booking_protection_plan_id: selectedRecord.id,
        booking_id: selectedRecord.booking_id,
        customer_id: selectedRecord.customer_id,
        claim_date: claimForm.claim_date,
        claim_amount: Number(claimForm.claim_amount || 0),
        description: claimForm.description,
        status: claimForm.status,
        admin_notes: claimForm.admin_notes,
        created_by: user?.id || null,
      }]);

      if (error) throw error;

      toast({ title: 'Claim recorded successfully' });
      setClaimDialogOpen(false);
      setSelectedRecord(null);
      loadData();
    } catch (error) {
      toast({
        title: 'Failed to save claim',
        description: error.message,
        variant: 'destructive',
      });
    }
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
                    <p><span className="text-gray-400">Amount:</span> ${Number(record.price_applied || 0).toFixed(2)}</p>
                    <p><span className="text-gray-400">Date/Time:</span> {format(parseISO(record.elected_at), 'PPP p')}</p>
                    <p><span className="text-gray-400">Service ID:</span> {record.service_id_at_purchase ?? 'N/A'}</p>
                    {cancelled && (
                      <p className="md:col-span-2">
                        <span className="text-gray-400">Cancelled:</span>{' '}
                        {format(parseISO(record.cancelled_at), 'PPP p')}
                        {record.election === 'accept' ? ' (was accepted before cancellation)' : ''}
                        {record.cancellation_reason ? ` — ${record.cancellation_reason}` : ''}
                      </p>
                    )}
                  </div>

                  {usedClaim && (
                    <div className="bg-orange-900/20 border border-orange-500/30 rounded-md p-3">
                      <p className="text-orange-300 font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Claim Used ({recordClaims.length})
                      </p>
                      <ul className="mt-2 space-y-1 text-orange-100">
                        {recordClaims.map((claim) => (
                          <li key={claim.id}>
                            {format(parseISO(`${claim.claim_date}T12:00:00`), 'PPP')} — ${Number(claim.claim_amount).toFixed(2)} ({claim.status})
                            {claim.description ? ` — ${claim.description}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {record.election === 'accept' && !cancelled && (
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

      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
          <DialogHeader>
            <DialogTitle>
              Log Claim — Order #{selectedRecord?.booking_id}
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
                value={claimForm.claim_amount}
                onChange={(e) => setClaimForm({ ...claimForm, claim_amount: e.target.value })}
                className="bg-gray-800 border-gray-600 text-white"
              />
            </div>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveClaim} className="bg-purple-600 hover:bg-purple-700">Save Claim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
