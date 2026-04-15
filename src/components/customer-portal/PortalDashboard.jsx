import React, { useEffect, useState } from 'react';
import { Truck, CheckCircle, Clock, MapPin, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, isFuture, parseISO, differenceInDays } from 'date-fns';
import { StatusDetailsModal } from './StatusDetailsModal';

export const PortalDashboard = ({ bookings, lastUpdated, onRefresh }) => {
  const [stats, setStats] = useState({
    activeCount: 0,
    pendingAddressCount: 0,
    upcomingDeliveriesCount: 0,
    completedCount: 0,
    urgentItems: []
  });
  
  const [selectedStatusType, setSelectedStatusType] = useState(null);

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
    if (pendingAddress.length > 0) {
      urgent.push({ type: 'address', text: `${pendingAddress.length} booking(s) require address verification immediately.` });
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

      {stats.urgentItems.length > 0 && (
        <div className="bg-orange-900/30 border border-orange-500/50 rounded-xl p-4 mb-6 shadow-lg shadow-orange-900/20">
          <h3 className="text-orange-400 font-bold flex items-center mb-2">
            <AlertTriangle className="mr-2 h-5 w-5" /> Attention Required
          </h3>
          <ul className="space-y-2">
            {stats.urgentItems.map((item, idx) => (
              <li key={idx} className="text-sm text-orange-200 flex items-start">
                <span className="mr-2">•</span> {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}

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