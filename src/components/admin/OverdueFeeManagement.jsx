import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertTriangle, Clock, DollarSign, Save } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';

export const OverdueFeeManagement = ({ booking, onUpdate }) => {
  const [overdueFee, setOverdueFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [returnStatus, setReturnStatus] = useState(null);

  useEffect(() => {
    checkReturnStatus();
  }, [booking]);

  const checkReturnStatus = async () => {
    try {
      // Check for lock event in tracking logs
      const { data: lockEvent, error } = await supabase
        .from('rental_tracking_logs')
        .select('event_timestamp')
        .eq('order_id', booking.id)
        .eq('event_type', 'lock')
        .order('event_timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[OverdueFeeManagement] Error checking return status:', error);
      }

      const scheduledReturnTime = new Date(booking.pickup_date);
      const actualReturnTime = lockEvent ? new Date(lockEvent.event_timestamp) : null;
      const now = new Date();

      // Calculate if overdue
      const minutesOverdue = actualReturnTime 
        ? differenceInMinutes(actualReturnTime, scheduledReturnTime)
        : differenceInMinutes(now, scheduledReturnTime);

      setReturnStatus({
        scheduled: scheduledReturnTime,
        actual: actualReturnTime,
        is_overdue: minutesOverdue > 30,
        minutes_overdue: minutesOverdue,
        has_lock_event: !!lockEvent
      });

    } catch (error) {
      console.error('[OverdueFeeManagement] Error:', error);
    }
  };

  const handleSaveOverdueFee = async () => {
    if (!overdueFee || parseFloat(overdueFee) <= 0) {
      toast({
        title: 'Invalid Fee',
        description: 'Please enter a valid overdue fee amount',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);

    try {
      const feeAmount = parseFloat(overdueFee);

      // Get current fees
      const currentFees = booking.fees || {};
      
      // Add overdue fee
      const updatedFees = {
        ...currentFees,
        overdue_fee: feeAmount
      };

      // Calculate new total
      const currentTotal = booking.total_price || 0;
      const newTotal = currentTotal + feeAmount;

      // Update booking
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          fees: updatedFees,
          total_price: newTotal
        })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      // Log the fee addition
      await supabase.from('rental_tracking_logs').insert({
        order_id: booking.id,
        event_type: 'admin_override',
        event_timestamp: new Date().toISOString(),
        notes: `Overdue fee of $${feeAmount.toFixed(2)} added by admin`
      });

      toast({
        title: 'Overdue Fee Added',
        description: `$${feeAmount.toFixed(2)} overdue fee has been added to the invoice`
      });

      setOverdueFee('');
      if (onUpdate) onUpdate();

    } catch (error) {
      console.error('[OverdueFeeManagement] Save error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add overdue fee',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  if (!returnStatus) {
    return null;
  }

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Clock className="h-5 w-5 text-orange-400" />
          Return Status & Overdue Fee Management
        </CardTitle>
        <CardDescription className="text-gray-300">
          Track return times and manage overdue fees
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Return Status Display */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/5 p-4 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">Scheduled Return</p>
            <p className="text-white font-bold">
              {format(returnStatus.scheduled, 'MMM d, yyyy h:mm a')}
            </p>
          </div>

          <div className="bg-white/5 p-4 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">Actual Return</p>
            <p className="text-white font-bold">
              {returnStatus.actual 
                ? format(returnStatus.actual, 'MMM d, yyyy h:mm a')
                : 'Not yet returned'}
            </p>
          </div>

          <div className="bg-white/5 p-4 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">Status</p>
            <div className="flex items-center gap-2">
              {returnStatus.is_overdue && !returnStatus.has_lock_event ? (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Overdue ({returnStatus.minutes_overdue} min)
                </Badge>
              ) : returnStatus.has_lock_event ? (
                <Badge variant="default" className="bg-green-600">
                  Returned
                </Badge>
              ) : (
                <Badge variant="secondary">
                  In Progress
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Overdue Fee Input */}
        {returnStatus.is_overdue && (
          <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-orange-400 mt-0.5" />
              <div>
                <p className="text-orange-300 font-semibold mb-1">
                  Overdue Rental Detected
                </p>
                <p className="text-sm text-orange-200">
                  This rental is {returnStatus.minutes_overdue} minutes past the scheduled return time.
                  {!returnStatus.has_lock_event && ' No lock event has been detected yet.'}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="overdueFee" className="text-white mb-2 block">
                  Add Overdue Fee
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="overdueFee"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={overdueFee}
                      onChange={(e) => setOverdueFee(e.target.value)}
                      className="pl-9 bg-white/10 border-white/20 text-white"
                    />
                  </div>
                  <Button
                    onClick={handleSaveOverdueFee}
                    disabled={saving || !overdueFee}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Add Fee'}
                  </Button>
                </div>
              </div>

              {booking.fees?.overdue_fee && (
                <div className="bg-white/5 p-3 rounded border border-white/10">
                  <p className="text-sm text-gray-400">Current Overdue Fee</p>
                  <p className="text-lg font-bold text-white">
                    ${parseFloat(booking.fees.overdue_fee).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};