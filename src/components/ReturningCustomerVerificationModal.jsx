import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Calendar, Package, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

export const ReturningCustomerVerificationModal = ({ isOpen, onClose, onReorderSelect }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [step, setStep] = useState('email'); // 'email' or 'bookings'
  const [error, setError] = useState('');

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('[ReturningCustomerVerificationModal] Fetching bookings for email:', email);

      const { data, error: fetchError } = await supabase
        .from('bookings')
        .select('*, customers(*)')
        .eq('email', email.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(10);

      if (fetchError) throw fetchError;

      console.log('[ReturningCustomerVerificationModal] Found bookings:', data?.length || 0);

      if (!data || data.length === 0) {
        setError('No previous bookings found for this email address');
        setLoading(false);
        return;
      }

      setBookings(data);
      setStep('bookings');
    } catch (err) {
      console.error('[ReturningCustomerVerificationModal] Error fetching bookings:', err);
      setError('Failed to fetch booking history. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = (booking) => {
    console.log('[ReturningCustomerVerificationModal] Reordering booking:', booking.id);
    
    if (onReorderSelect) {
      onReorderSelect(booking);
    }

    toast({
      title: 'Booking Loaded',
      description: 'Your previous booking details have been pre-filled. Please review and update as needed.',
    });

    handleClose();
  };

  const handleClose = () => {
    setEmail('');
    setBookings([]);
    setStep('email');
    setError('');
    onClose();
  };

  const handleBack = () => {
    setBookings([]);
    setStep('email');
    setError('');
  };

  const formatBookingDate = (dateString) => {
    try {
      return format(new Date(dateString), 'MMMM d, yyyy');
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-green-400 bg-green-900/20 border-green-500/30';
      case 'active':
        return 'text-blue-400 bg-blue-900/20 border-blue-500/30';
      case 'cancelled':
        return 'text-red-400 bg-red-900/20 border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-900/20 border-gray-500/30';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {step === 'email' ? 'Welcome Back!' : 'Your Previous Bookings'}
          </DialogTitle>
          <DialogDescription>
            {step === 'email'
              ? 'Enter your email to view your booking history and quickly reorder.'
              : 'Select a previous booking to reorder with pre-filled details.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' ? (
          <form onSubmit={handleEmailSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300" />
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  className="pl-10 text-white"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || !email}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  'View Bookings'
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="grid gap-3">
              {bookings.map((booking) => (
                <Card key={booking.id} className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg text-white">
                          {booking.plan?.name || 'Service'}
                        </CardTitle>
                        <CardDescription className="text-blue-200/80">
                          Order #{booking.id}
                        </CardDescription>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Calendar className="h-4 w-4 text-blue-400" />
                      <span>
                        {formatBookingDate(booking.drop_off_date)}
                        {booking.pickup_date && ` - ${formatBookingDate(booking.pickup_date)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Package className="h-4 w-4 text-blue-400" />
                      <span>Total: ${booking.total_price?.toFixed(2) || '0.00'}</span>
                    </div>
                    <Button
                      onClick={() => handleReorder(booking)}
                      className="w-full mt-3 bg-green-600 hover:bg-green-700"
                      size="sm"
                    >
                      Reorder This Service
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-3 pt-4 border-t border-white/10">
              <Button
                variant="outline"
                onClick={handleBack}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                variant="ghost"
                onClick={handleClose}
                className="flex-1"
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};