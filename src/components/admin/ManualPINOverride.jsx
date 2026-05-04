import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Key, Send, Loader2, Calendar } from 'lucide-react';
import { format } from 'date-fns';

export const ManualPINOverride = ({ booking, onUpdate }) => {
  const [currentPin, setCurrentPin] = useState(null);
  const [newStartDate, setNewStartDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchCurrentPin();
  }, [booking]);

  const fetchCurrentPin = async () => {
    try {
      const { data, error } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', booking.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[ManualPINOverride] Fetch error:', error);
      }

      setCurrentPin(data);
    } catch (error) {
      console.error('[ManualPINOverride] Error:', error);
    }
  };

  const handleGenerateEmergencyCode = async () => {
    if (!newStartDate || !newStartTime || !newEndDate || !newEndTime) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all date and time fields',
        variant: 'destructive'
      });
      return;
    }

    setGenerating(true);

    try {
      const startDateTime = new Date(`${newStartDate}T${newStartTime}`);
      const endDateTime = new Date(`${newEndDate}T${newEndTime}`);

      if (endDateTime <= startDateTime) {
        throw new Error('End time must be after start time');
      }

      // Call generate-access-code edge function
      const { data, error } = await supabase.functions.invoke('generate-access-code', {
        body: {
          booking_id: booking.id,
          customer_email: booking.email,
          customer_phone: booking.phone,
          rental_start_time: startDateTime.toISOString(),
          rental_end_time: endDateTime.toISOString()
        }
      });

      if (error) throw error;

      // Mark previous PIN as expired if exists
      if (currentPin) {
        await supabase
          .from('rental_access_codes')
          .update({ status: 'expired' })
          .eq('id', currentPin.id);
      }

      // Log the manual override
      await supabase.from('rental_tracking_logs').insert({
        order_id: booking.id,
        event_type: 'admin_override',
        event_timestamp: new Date().toISOString(),
        notes: `Manual PIN override: ${data.access_pin} (${format(startDateTime, 'MMM d h:mm a')} - ${format(endDateTime, 'MMM d h:mm a')})`
      });

      toast({
        title: 'Emergency Code Generated',
        description: `New PIN: ${data.access_pin}`
      });

      fetchCurrentPin();
      setDialogOpen(false);

      // Reset form
      setNewStartDate('');
      setNewStartTime('');
      setNewEndDate('');
      setNewEndTime('');

    } catch (error) {
      console.error('[ManualPINOverride] Generate error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate emergency code',
        variant: 'destructive'
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSendToCustomer = async () => {
    if (!currentPin) {
      toast({
        title: 'No Active PIN',
        description: 'Please generate a PIN first',
        variant: 'destructive'
      });
      return;
    }

    setSending(true);

    try {
      const portalLink = `${window.location.origin}/customer-portal/login?order_id=${booking.id}&phone=${booking.phone}`;

      // Send notification via edge function
      const { error: emailError } = await supabase.functions.invoke('send-booking-confirmation', {
        body: {
          booking_id: booking.id,
          email_type: 'pin_update',
          pin: currentPin.access_pin,
          start_time: currentPin.start_time,
          end_time: currentPin.end_time,
          portal_link: portalLink
        }
      });

      if (emailError) throw emailError;

      // Log the send action
      await supabase.from('rental_tracking_logs').insert({
        order_id: booking.id,
        event_type: 'admin_override',
        event_timestamp: new Date().toISOString(),
        notes: `PIN sent to customer via email/SMS: ${currentPin.access_pin}`
      });

      toast({
        title: 'PIN Sent',
        description: 'Access code has been sent to the customer'
      });

    } catch (error) {
      console.error('[ManualPINOverride] Send error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send PIN to customer',
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Key className="h-5 w-5 text-purple-400" />
          Manual PIN Override
        </CardTitle>
        <CardDescription className="text-gray-300">
          Generate emergency access codes and manage customer access
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Current Active PIN Display */}
        {currentPin && (
          <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
            <p className="text-sm text-purple-300 mb-2">Current Active PIN</p>
            <p className="text-4xl font-black text-white mb-2 font-mono tracking-widest">
              {currentPin.access_pin}
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-gray-400">Valid From</p>
                <p className="text-white">{format(new Date(currentPin.start_time), 'MMM d, h:mm a')}</p>
              </div>
              <div>
                <p className="text-gray-400">Valid Until</p>
                <p className="text-white">{format(new Date(currentPin.end_time), 'MMM d, h:mm a')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Generate Emergency Code Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full bg-purple-600 hover:bg-purple-700">
              <Key className="mr-2 h-4 w-4" />
              Generate Emergency Code
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-700 text-white">
            <DialogHeader>
              <DialogTitle>Generate Emergency Access Code</DialogTitle>
              <DialogDescription className="text-gray-400">
                Create a custom access code with specific time validity
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startDate" className="text-white">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="bg-white/10 border-white/20 text-white"
                  />
                </div>
                <div>
                  <Label htmlFor="startTime" className="text-white">Start Time</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    className="bg-white/10 border-white/20 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="endDate" className="text-white">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="bg-white/10 border-white/20 text-white"
                  />
                </div>
                <div>
                  <Label htmlFor="endTime" className="text-white">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    className="bg-white/10 border-white/20 text-white"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleGenerateEmergencyCode}
                disabled={generating}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    Generate & Sync
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send to Customer Button */}
        {currentPin && (
          <Button
            onClick={handleSendToCustomer}
            disabled={sending}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send to Customer
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};