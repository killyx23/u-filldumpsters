import React, { useEffect, useState } from 'react';
import { Users, Copy, Loader2, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const generateReferralCode = (customerId) => {
  const suffix = String(customerId).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `UFILL-${suffix}-${random}`;
};

export const PortalReferralsSection = ({ customerId, customerEmail }) => {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [primaryCode, setPrimaryCode] = useState(null);

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!customerId) {
      setLoading(false);
      return;
    }

    const loadReferrals = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('referrals')
          .select('*')
          .eq('referrer_customer_id', customerId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setReferrals(data || []);
        if (data?.length > 0) {
          setPrimaryCode(data[0].referral_code);
        }
      } catch (err) {
        console.error('[PortalReferralsSection] Load error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadReferrals();
  }, [customerId]);

  const handleCreateCode = async () => {
    if (!customerId) return;
    setCreating(true);
    try {
      const code = generateReferralCode(customerId);
      const { data, error } = await supabase
        .from('referrals')
        .insert({
          referrer_customer_id: customerId,
          referral_code: code,
          referee_email: null,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      setPrimaryCode(data.referral_code);
      setReferrals((prev) => [data, ...prev]);
      toast({
        title: 'Referral link ready',
        description: 'Share this link with a friend. You can generate additional links anytime.',
      });
    } catch (err) {
      console.error('[PortalReferralsSection] Create error:', err);
      toast({
        title: 'Could not create referral code',
        description: err.message || 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const referralLink = primaryCode ? `${siteUrl}/?ref=${encodeURIComponent(primaryCode)}` : '';
  const rewardedCount = referrals.filter((ref) => ref.status === 'rewarded').length;

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy manually.', variant: 'destructive' });
    }
  };

  return (
    <Card className="bg-green-900/20 border-green-500/30 mb-6">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Users className="h-5 w-5 text-green-400" />
          Refer Friends & Earn Rewards
        </CardTitle>
        <CardDescription className="text-green-100/80">
          Share referral links. Rewards stay pending until the referred booking is completed, then they activate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading referrals...
          </div>
        ) : (
          <>
            {!primaryCode ? (
              <Button
                onClick={handleCreateCode}
                disabled={creating}
                className="bg-green-600 hover:bg-green-700"
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Get My Referral Link
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-300 mb-1">Your referral code</p>
                  <div className="flex gap-2">
                    <Input readOnly value={primaryCode} className="bg-black/30 border-white/20 text-white font-mono" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(primaryCode, 'Referral code')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-300 mb-1">Share this link</p>
                  <div className="flex gap-2">
                    <Input readOnly value={referralLink} className="bg-black/30 border-white/20 text-white text-sm" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(referralLink, 'Referral link')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleCreateCode}
                  disabled={creating}
                  variant="outline"
                >
                  {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                  Generate Another Link
                </Button>
              </div>
            )}

            {referrals.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <p className="text-sm font-medium text-white mb-2">Referral history</p>
                <ul className="space-y-2 text-sm text-gray-300">
                  {referrals.slice(0, 8).map((ref) => {
                    const statusText = String(ref.status || 'pending').replace(/_/g, ' ');
                    const shareUrl = `${siteUrl}/?ref=${encodeURIComponent(ref.referral_code)}`;
                    return (
                      <li key={ref.id} className="bg-black/20 border border-white/10 rounded p-2">
                        <div className="flex justify-between items-center gap-2">
                          <span className="truncate mr-2 font-mono">{ref.referral_code}</span>
                          <span className="capitalize text-xs">
                            {statusText}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Input readOnly value={shareUrl} className="bg-black/30 border-white/20 text-white text-xs" />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(shareUrl, 'Referral link')}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {rewardedCount > 0 && (
              <div className="bg-green-900/30 border border-green-500/30 rounded-lg p-3 text-sm text-green-100">
                Congratulations! Your first referral reward has been applied and is now active.
              </div>
            )}
          </>
        )}
        {customerEmail && (
          <p className="text-xs text-gray-500">
            Rewards are credited to {customerEmail} when referrals complete a booking.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
