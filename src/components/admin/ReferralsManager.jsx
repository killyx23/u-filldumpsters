import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Users, RefreshCw } from 'lucide-react';

export const ReferralsManager = () => {
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [query, setQuery] = useState('');

  const fetchReferrals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('referrals')
        .select('id, referral_code, status, referrer_points_awarded, referee_email, created_at, completed_at, completed_booking_id, referrer:referrer_customer_id(name, email), referee:referee_customer_id(name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReferrals(data || []);
    } catch (err) {
      console.error('[ReferralsManager] Fetch error:', err);
      toast({
        title: 'Error',
        description: 'Failed to load referrals',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferrals();
  }, []);

  const filteredReferrals = useMemo(() => {
    const needle = query.toLowerCase().trim();
    if (!needle) return referrals;
    return referrals.filter((ref) => {
      const haystack = [
        ref.referral_code,
        ref.status,
        ref.referrer?.name,
        ref.referrer?.email,
        ref.referee?.name,
        ref.referee?.email,
        ref.referee_email,
        ref.completed_booking_id ? String(ref.completed_booking_id) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, referrals]);

  const updateStatus = async (referralId, nextStatus) => {
    setUpdatingId(referralId);
    try {
      const payload = {
        status: nextStatus,
        completed_at: nextStatus === 'pending' ? null : new Date().toISOString(),
      };
      const { error } = await supabase
        .from('referrals')
        .update(payload)
        .eq('id', referralId);
      if (error) throw error;

      setReferrals((prev) =>
        prev.map((row) => (row.id === referralId ? { ...row, ...payload } : row))
      );
      toast({
        title: 'Referral updated',
        description: `Referral status changed to ${nextStatus.replace(/_/g, ' ')}.`,
      });
    } catch (err) {
      console.error('[ReferralsManager] Update error:', err);
      toast({
        title: 'Update failed',
        description: err.message || 'Could not update referral status',
        variant: 'destructive',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Users className="h-5 w-5" />
          Referrals Operations
        </CardTitle>
        <CardDescription className="text-gray-400">
          Review referral activity, monitor status, and manage exceptions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search code, customer, status, booking..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-white"
          />
          <Button
            variant="outline"
            onClick={fetchReferrals}
            className="shrink-0"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          </div>
        ) : filteredReferrals.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No referrals found</p>
        ) : (
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {filteredReferrals.map((ref) => (
              <div key={ref.id} className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-white font-semibold">{ref.referral_code}</p>
                    <p className="text-xs text-gray-400">
                      Referrer: {ref.referrer?.name || ref.referrer?.email || 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-400">
                      Referee: {ref.referee?.name || ref.referee?.email || ref.referee_email || 'Pending'}
                    </p>
                    <p className="text-xs text-gray-400">
                      Created: {new Date(ref.created_at).toLocaleString()}
                      {ref.completed_booking_id ? ` • Booking #${ref.completed_booking_id}` : ''}
                    </p>
                    <p className="text-xs text-gray-300">
                      Bonus awarded: {Number(ref.referrer_points_awarded || 0)} pts
                    </p>
                  </div>
                  <div className="text-right space-y-2">
                    <span className="text-xs uppercase text-blue-300">
                      {String(ref.status || 'pending').replace(/_/g, ' ')}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === ref.id || ref.status === 'completed'}
                        onClick={() => updateStatus(ref.id, 'completed')}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === ref.id || ref.status === 'rewarded'}
                        onClick={() => updateStatus(ref.id, 'rewarded')}
                      >
                        Rewarded
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === ref.id || ref.status === 'expired'}
                        onClick={() => updateStatus(ref.id, 'expired')}
                      >
                        Expire
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
