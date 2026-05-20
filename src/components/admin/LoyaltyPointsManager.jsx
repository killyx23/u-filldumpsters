import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Gift, TrendingUp, Users, Settings, Plus, Minus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export const LoyaltyPointsManager = () => {
  const [settings, setSettings] = useState({
    points_per_dollar: 10,
    points_to_dollar: 100,
  });
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [adjustmentPoints, setAdjustmentPoints] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchCustomersWithPoints();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('loyalty_settings')
        .select('*')
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('[LoyaltyPointsManager] Error fetching settings:', error);
        return;
      }

      if (data) {
        setSettings({
          points_per_dollar: data.points_per_dollar || 10,
          points_to_dollar: data.points_to_dollar || 100,
        });
      }
    } catch (err) {
      console.error('[LoyaltyPointsManager] Exception fetching settings:', err);
    }
  };

  const fetchCustomersWithPoints = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('loyalty_points')
        .select('*, customers(id, name, email)')
        .order('points_balance', { ascending: false });

      if (error) throw error;

      setCustomers(data || []);
    } catch (err) {
      console.error('[LoyaltyPointsManager] Error fetching customers:', err);
      toast({
        title: 'Error',
        description: 'Failed to load customer loyalty data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('loyalty_settings')
        .select('id')
        .maybeSingle();

      let result;
      if (existing) {
        result = await supabase
          .from('loyalty_settings')
          .update(settings)
          .eq('id', existing.id);
      } else {
        result = await supabase
          .from('loyalty_settings')
          .insert([settings]);
      }

      if (result.error) throw result.error;

      toast({
        title: 'Settings Saved',
        description: 'Loyalty points conversion rates updated successfully',
      });
    } catch (err) {
      console.error('[LoyaltyPointsManager] Error saving settings:', err);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustPoints = async (customerId, pointsDelta, reason) => {
    if (!pointsDelta || pointsDelta === 0) {
      toast({
        title: 'Invalid Adjustment',
        description: 'Please enter a non-zero points value',
        variant: 'destructive',
      });
      return;
    }

    try {
      let { data: loyalty } = await supabase
        .from('loyalty_points')
        .select('points_balance, total_points_earned, total_points_redeemed')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (!loyalty) {
        const { data: created, error: createError } = await supabase
          .from('loyalty_points')
          .insert({
            customer_id: customerId,
            points_balance: 0,
            total_points_earned: 0,
            total_points_redeemed: 0,
          })
          .select('points_balance, total_points_earned, total_points_redeemed')
          .single();

        if (createError) throw createError;
        loyalty = created;
      }

      const newBalance = loyalty.points_balance + pointsDelta;
      if (newBalance < 0) {
        toast({
          title: 'Invalid Adjustment',
          description: 'Cannot reduce points below zero',
          variant: 'destructive',
        });
        return;
      }

      const updates = {
        points_balance: newBalance,
        last_updated: new Date().toISOString(),
      };

      if (pointsDelta > 0) {
        updates.total_points_earned = loyalty.total_points_earned + pointsDelta;
      } else {
        updates.total_points_redeemed = loyalty.total_points_redeemed + Math.abs(pointsDelta);
      }

      const { error: updateError } = await supabase
        .from('loyalty_points')
        .update(updates)
        .eq('customer_id', customerId);

      if (updateError) throw updateError;

      // Log transaction
      await supabase.from('loyalty_transactions').insert({
        customer_id: customerId,
        transaction_type: pointsDelta > 0 ? 'admin_adjustment_add' : 'admin_adjustment_remove',
        points_amount: Math.abs(pointsDelta),
        notes: reason || 'Manual admin adjustment',
      });

      toast({
        title: 'Points Adjusted',
        description: `Successfully ${pointsDelta > 0 ? 'added' : 'removed'} ${Math.abs(pointsDelta)} points`,
      });

      fetchCustomersWithPoints();
      setSelectedCustomer(null);
      setAdjustmentPoints(0);
      setAdjustmentReason('');
    } catch (err) {
      console.error('[LoyaltyPointsManager] Error adjusting points:', err);
      toast({
        title: 'Error',
        description: 'Failed to adjust points',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Settings className="h-5 w-5" />
            Loyalty Points Settings
          </CardTitle>
          <CardDescription className="text-gray-400">
            Configure how customers earn and redeem loyalty points
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pointsPerDollar" className="text-white">
                Points Earned Per Dollar Spent
              </Label>
              <Input
                id="pointsPerDollar"
                type="number"
                min="1"
                value={settings.points_per_dollar}
                onChange={(e) => setSettings({ ...settings, points_per_dollar: Number(e.target.value) })}
                className="text-white"
              />
              <p className="text-xs text-gray-400">
                Example: If set to 10, customer earns 10 points for every $1 spent
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pointsToDollar" className="text-white">
                Points Required Per Dollar Discount
              </Label>
              <Input
                id="pointsToDollar"
                type="number"
                min="1"
                value={settings.points_to_dollar}
                onChange={(e) => setSettings({ ...settings, points_to_dollar: Number(e.target.value) })}
                className="text-white"
              />
              <p className="text-xs text-gray-400">
                Example: If set to 100, customer needs 100 points to get $1 discount
              </p>
            </div>
          </div>

          <Button
            onClick={handleSaveSettings}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Users className="h-5 w-5" />
            Customer Loyalty Points
          </CardTitle>
          <CardDescription className="text-gray-400">
            View and manage customer point balances
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : customers.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No customers with loyalty points yet</p>
          ) : (
            <div className="space-y-2">
              {customers.map((customer) => (
                <div
                  key={customer.customer_id}
                  className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white font-semibold">
                      {customer.customers?.name || customer.customers?.email || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-400">{customer.customers?.email}</p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>Balance: <span className="text-green-400 font-bold">{customer.points_balance}</span></span>
                      <span>Earned: {customer.total_points_earned}</span>
                      <span>Redeemed: {customer.total_points_redeemed}</span>
                    </div>
                  </div>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedCustomer(customer)}
                      >
                        Adjust Points
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Adjust Points for {customer.customers?.name}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="adjustmentPoints">Points Adjustment</Label>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => setAdjustmentPoints(Math.max(-customer.points_balance, adjustmentPoints - 10))}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              id="adjustmentPoints"
                              type="number"
                              value={adjustmentPoints}
                              onChange={(e) => setAdjustmentPoints(Number(e.target.value))}
                              className="flex-1 text-white"
                              placeholder="Enter points (positive to add, negative to remove)"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => setAdjustmentPoints(adjustmentPoints + 10)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-gray-400">
                            Current balance: {customer.points_balance} | New balance: {customer.points_balance + adjustmentPoints}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="adjustmentReason">Reason (optional)</Label>
                          <Input
                            id="adjustmentReason"
                            value={adjustmentReason}
                            onChange={(e) => setAdjustmentReason(e.target.value)}
                            className="text-white"
                            placeholder="e.g., Customer service compensation"
                          />
                        </div>

                        <Button
                          onClick={() => handleAdjustPoints(customer.customer_id, adjustmentPoints, adjustmentReason)}
                          disabled={adjustmentPoints === 0}
                          className="w-full bg-blue-600 hover:bg-blue-700"
                        >
                          Apply Adjustment
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};