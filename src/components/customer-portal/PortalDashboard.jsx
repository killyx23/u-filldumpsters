import React, { useEffect, useState } from 'react';
import { Truck, CheckCircle, Clock, MapPin, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, isFuture, parseISO, differenceInDays } from 'date-fns';
import { StatusDetailsModal } from './StatusDetailsModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const AttentionRequiredDialog = ({ open, onOpenChange, items, onNavigateToTab }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-500/50 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-yellow-400 text-2xl">Things That Need Attention</DialogTitle>
          <DialogDescription>
            These are important account items to complete. Click one to open the right section.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
          {items.length > 0 ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigateToTab?.(item.targetTab);
                onOpenChange(false);
              }}
              className={`w-full text-left p-4 rounded-lg border transition-colors hover:bg-white/10 ${
                item.severity === 'urgent'
                  ? 'border-red-500/40 bg-red-900/20'
                  : item.severity === 'warning'
                    ? 'border-yellow-500/40 bg-yellow-900/20'
                    : 'border-blue-500/40 bg-blue-900/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-gray-200 mt-1">{item.description}</p>
                  <p className="text-xs text-gray-300 mt-2">{item.nextStep}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300" />
              </div>
            </button>
          )) : (
            <p className="text-sm text-blue-200 py-6 text-center">No attention items right now.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const PortalDashboard = ({ bookings, lastUpdated, onRefresh, onNavigateToTab }) => {
  const [stats, setStats] = useState({
    activeCount: 0,
    pendingAddressCount: 0,
    upcomingDeliveriesCount: 0,
    completedCount: 0,
    urgentItems: []
  });
  
  const [selectedStatusType, setSelectedStatusType] = useState(null);
  const [attentionDialogOpen, setAttentionDialogOpen] = useState(false);
  const [attentionItems, setAttentionItems] = useState([]);

  useEffect(() => {
    if (!bookings) return;

    const active = bookings.filter(b => ['pending_payment', 'Confirmed', 'Delivered', 'waiting_to_be_returned', 'Rescheduled'].includes(b.status) && !b.pending_address_verification);
    const pendingAddress = bookings.filter(b => b.pending_address_verification);
    const upcoming = bookings.filter(b => {
      if (!b.drop_off_date || b.status === 'Cancelled' || b.status === 'Completed') return false;
      const dropDate = parseISO(b.drop_off_date);
      return isFuture(dropDate) && differenceInDays(dropDate, new Date()) <= 7;
    });
    const completed = bookings.filter(b => b.status === 'Completed' || b.status === 'flagged');

    const urgent = [];
    const attention = [];
    if (pendingAddress.length > 0) {
      urgent.push({ type: 'address', text: `${pendingAddress.length} booking(s) require address verification immediately.` });
      attention.push({
        id: 'pending-address',
        severity: 'warning',
        title: `Address verification required (${pendingAddress.length})`,
        description: 'One or more bookings are waiting for address verification.',
        nextStep: 'Open Verification and complete the required address checks.',
        targetTab: 'verification',
      });
    }
    const hasPaymentDelta = (b) => {
      const details = b.payment_delta_details;
      return details && (Number(details.amount_due) > 0 || details.state === 'pending');
    };
    const pendingPayment = bookings.filter((b) => b.status === 'pending_payment' && hasPaymentDelta(b));
    if (pendingPayment.length > 0) {
      attention.push({
        id: 'pending-payment',
        severity: 'urgent',
        title: `Payment adjustment pending (${pendingPayment.length})`,
        description: 'A payment difference still needs to be completed.',
        nextStep: 'Open Bookings and review payment updates.',
        targetTab: 'bookings',
      });
    }
    const pendingVerification = bookings.filter((b) => ['pending_review', 'pending_verification'].includes(b.status));
    if (pendingVerification.length > 0) {
      attention.push({
        id: 'pending-verification',
        severity: 'warning',
        title: `Verification review pending (${pendingVerification.length})`,
        description: 'Some bookings require verification before they can continue.',
        nextStep: 'Open Verification and follow the required next steps.',
        targetTab: 'verification',
      });
    }
    const cancellationPending = bookings.filter((b) => b.status === 'cancellation_pending');
    if (cancellationPending.length > 0) {
      attention.push({
        id: 'cancellation-pending',
        severity: 'urgent',
        title: `Cancellation request pending (${cancellationPending.length})`,
        description: 'A cancellation request is waiting for final action.',
        nextStep: 'Open Messages for support instructions.',
        targetTab: 'messages',
      });
    }

    const verySoon = upcoming.filter(b => differenceInDays(parseISO(b.drop_off_date), new Date()) <= 2);
    if (verySoon.length > 0) {
      urgent.push({ type: 'delivery', text: `You have ${verySoon.length} delivery coming up within 48 hours.` });
    }

    setStats({
      activeCount: active.length,
      pendingAddressCount: pendingAddress.length,
      upcomingDeliveriesCount: upcoming.length,
      completedCount: completed.length,
      urgentItems: urgent
    });
    setAttentionItems(attention);
  }, [bookings]);

  const customerId = bookings?.[0]?.customer_id;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Five-Second Health Check</h2>
          <p className="text-sm text-blue-200">A quick overview of your account status.</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 mb-2">
            Last updated: {lastUpdated ? format(lastUpdated, 'h:mm:ss a') : 'Just now'}
          </p>
          <Button variant="outline" size="sm" onClick={onRefresh} className="h-8 border-white/20 text-white hover:bg-white/10">
            <RefreshCw className="mr-2 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {(stats.urgentItems.length > 0 || attentionItems.length > 0) && (
        <div className="bg-orange-900/30 border border-orange-500/50 rounded-xl p-4 mb-6 shadow-lg shadow-orange-900/20">
          <div className="flex items-center justify-between">
            <h3 className="text-orange-400 font-bold flex items-center mb-2">
              <AlertTriangle className="mr-2 h-5 w-5" /> Attention Required
            </h3>
            {attentionItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAttentionDialogOpen(true)}
                className="border-yellow-400/40 text-yellow-300 hover:bg-yellow-400/10"
              >
                View {attentionItems.length} item(s)
              </Button>
            )}
          </div>
          {attentionItems.length > 0 && (
            <p className="text-xs text-yellow-200 mb-2">
              You have {attentionItems.length} important item(s) to review.
            </p>
          )}
          <ul className="space-y-2">
            {stats.urgentItems.map((item, idx) => (
              <li key={idx} className="text-sm text-orange-200 flex items-start">
                <span className="mr-2">•</span> {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AttentionRequiredDialog
        open={attentionDialogOpen}
        onOpenChange={setAttentionDialogOpen}
        items={attentionItems}
        onNavigateToTab={onNavigateToTab}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card 
          onClick={() => setSelectedStatusType('active')}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer interactive-hover"
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-200">Active Bookings</CardTitle>
            <div className="bg-green-500/20 p-2 rounded-full"><CheckCircle className="h-4 w-4 text-green-400" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.activeCount}</div>
            <p className="text-xs text-gray-400 mt-1">Currently in progress or scheduled</p>
          </CardContent>
        </Card>

        <Card 
          onClick={() => setSelectedStatusType('pending')}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer interactive-hover"
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-200">Pending Address</CardTitle>
            <div className="bg-yellow-500/20 p-2 rounded-full"><MapPin className="h-4 w-4 text-yellow-400" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.pendingAddressCount}</div>
            <p className="text-xs text-gray-400 mt-1">Awaiting manual verification</p>
          </CardContent>
        </Card>

        <Card 
          onClick={() => setSelectedStatusType('upcoming')}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer interactive-hover"
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-200">Upcoming Deliveries</CardTitle>
            <div className="bg-blue-500/20 p-2 rounded-full"><Truck className="h-4 w-4 text-blue-400" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.upcomingDeliveriesCount}</div>
            <p className="text-xs text-gray-400 mt-1">Scheduled within the next 7 days</p>
          </CardContent>
        </Card>

        <Card 
          onClick={() => setSelectedStatusType('completed')}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer interactive-hover"
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-200">Completed Rentals</CardTitle>
            <div className="bg-gray-500/20 p-2 rounded-full"><Clock className="h-4 w-4 text-gray-400" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.completedCount}</div>
            <p className="text-xs text-gray-400 mt-1">Total finished services</p>
          </CardContent>
        </Card>
      </div>

      <StatusDetailsModal 
        isOpen={!!selectedStatusType} 
        onClose={() => setSelectedStatusType(null)} 
        type={selectedStatusType}
        customerId={customerId}
      />
    </div>
  );
};