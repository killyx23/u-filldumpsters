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
        description: 'Share your code with friends to earn rewards when they book.',
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
          Share your referral link. When someone books using your code, you earn bonus loyalty points.
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
              </div>
            )}

            {referrals.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <p className="text-sm font-medium text-white mb-2">Referral history</p>
                <ul className="space-y-1 text-sm text-gray-300">
                  {referrals.slice(0, 5).map((ref) => (
                    <li key={ref.id} className="flex justify-between">
                      <span>{ref.referral_code}</span>
                      <span className="capitalize">{ref.status}</span>
                    </li>
                  ))}
                </ul>
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
