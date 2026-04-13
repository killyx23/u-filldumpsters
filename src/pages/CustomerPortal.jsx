
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Key } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

import { PortalNavigation } from '@/components/customer-portal/PortalNavigation';
import { PortalDashboard } from '@/components/customer-portal/PortalDashboard';
import { ActiveBookingsTracker } from '@/components/customer-portal/ActiveBookingsTracker';
import { BookingsList } from '@/components/customer-portal/BookingsList';
import { PortalCalendar } from '@/components/customer-portal/PortalCalendar';
import { DocumentsSection } from '@/components/customer-portal/DocumentsSection';
import { ProfileManagement } from '@/components/customer-portal/ProfileManagement';
import { CommunicationHub } from '@/components/customer-portal/CommunicationHub';
import { VerificationManager } from '@/components/customer-portal/VerificationManager';
import { CustomerPortalResourcesPage } from '@/components/customer-portal/CustomerPortalResourcesPage';
import { CancelDialog, RescheduleDialog } from '@/components/customer-portal/BookingActionsDialogs';

export default function CustomerPortal() {
    const { user, signOut, loading: authLoading, session } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Login State
    const [loginPortalId, setLoginPortalId] = useState('');
    const [loginPhone, setLoginPhone] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    // Portal State
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard');
    const [customerData, setCustomerData] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    // Action States
    const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);
    const [selectedBookingForCancel, setSelectedBookingForCancel] = useState(null);
    const [selectedBookingForReschedule, setSelectedBookingForReschedule] = useState(null);

    // Initialization & Params logic
    useEffect(() => {
        const pid = searchParams.get('portal_id');
        const ph = searchParams.get('phone');
        if (pid) setLoginPortalId(pid);
        if (ph) setLoginPhone(ph);
    }, [searchParams]);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        setSearchParams({ tab: tabId });
    };

    const fetchData = useCallback(async (isInitialLoad = true) => {
        if (!user || !session) {
            if (isInitialLoad) setLoading(false);
            return;
        }
        if (isInitialLoad) setLoading(true);

        const customerDbId = user.user_metadata?.customer_db_id;
        if (!customerDbId) {
            toast({ title: "Authentication Error", description: "Could not find your profile.", variant: "destructive" });
            if (isInitialLoad) setLoading(false);
            await signOut();
            return;
        }

        try {
            const { data, error } = await supabase.functions.invoke('get-customer-details', {
                body: { customerId: customerDbId }
            });

            if (error) throw new Error(error.message);
            if (data.error) throw new Error(data.error);

            setCustomerData(data.customer);
            setBookings(data.bookings || []);
            setNotes(data.notes || []);
            setLastUpdated(new Date());

        } catch (error) {
            console.error("Portal Fetch Error:", error);
            // Don't auto-sign out on simple fetch failures, just show error
            toast({ title: "Failed to load data", description: error.message, variant: "destructive" });
        } finally {
            if (isInitialLoad) setLoading(false);
        }
    }, [user, session, signOut]);

    // Initial fetch
    useEffect(() => {
        if (!authLoading) {
            if (user && session) fetchData();
            else setLoading(false);
        }
    }, [user, session, authLoading, fetchData]);

    // Auto-refresh interval (30 seconds)
    useEffect(() => {
        if (!user || !session) return;
        const intervalId = setInterval(() => {
            fetchData(false);
        }, 30000);
        return () => clearInterval(intervalId);
    }, [user, session, fetchData]);

    // Real-time subscriptions
    useEffect(() => {
        if (!customerData) return;
        
        const channel = supabase.channel(`customer-portal-realtime-${customerData.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_notes', filter: `customer_id=eq.${customerData.id}` }, (payload) => {
                setNotes(prev => [...prev, payload.new]);
                if (payload.new.author_type === 'admin') {
                    toast({ title: "New Message", description: "You have a new message from support." });
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${customerData.id}` }, () => {
                fetchData(false);
                toast({ title: "Update", description: "A booking status has changed." });
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [customerData, fetchData]);

    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        setIsLoggingIn(true);
        try {
            const { data, error } = await supabase.functions.invoke('customer-portal-login', {
                body: { portal_number: loginPortalId, phone: loginPhone }
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            if (data?.session) {
                await supabase.auth.setSession(data.session);
                window.location.reload();
            } else {
                throw new Error("Invalid response from server.");
            }
        } catch (err) {
            toast({ title: 'Login Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsLoggingIn(false);
        }
    };

    if (loading || authLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    if (!user || !session || !customerData) {
        return (
            <div className="container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[70vh]">
                <Card className="bg-white/10 backdrop-blur-md border-white/20 shadow-2xl max-w-md w-full">
                    <CardHeader className="text-center pb-4">
                        <div className="mx-auto bg-yellow-500/20 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                            <Key className="h-8 w-8 text-yellow-400" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-white mb-2">Customer Portal</CardTitle>
                        <CardDescription className="text-blue-200">
                            Enter your credentials to access your account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLoginSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="portal_id" className="text-gray-300">Customer Portal Number</Label>
                                <Input id="portal_id" value={loginPortalId} onChange={(e) => setLoginPortalId(e.target.value)} placeholder="CID-123456" required className="bg-black/30 border-white/10 text-white placeholder:text-gray-500" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-gray-300">Phone Number</Label>
                                <Input id="phone" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} placeholder="(555) 123-4567" required className="bg-black/30 border-white/10 text-white placeholder:text-gray-500" />
                            </div>
                            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4 py-6 text-lg" disabled={isLoggingIn}>
                                {isLoggingIn ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Key className="mr-2 h-5 w-5" />} Access Portal
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const hasUnreadMessages = notes.some(n => !n.is_read && n.author_type === 'admin');
    const hasPendingVerifications = bookings.some(b => b.pending_address_verification) || customerData.has_incomplete_verification;

    return (
        <div className="container mx-auto py-8 px-4 flex flex-col lg:flex-row min-h-[calc(100vh-200px)]">
            
            <PortalNavigation 
                activeTab={activeTab} 
                onTabChange={handleTabChange} 
                hasUnreadMessages={hasUnreadMessages}
                hasPendingVerifications={hasPendingVerifications}
            />

            <div className="flex-1 lg:pl-4 min-w-0">
                {activeTab === 'dashboard' && (
                    <PortalDashboard bookings={bookings} customerData={customerData} lastUpdated={lastUpdated} onRefresh={() => fetchData(true)} />
                )}
                
                {activeTab === 'bookings' && (
                    <BookingsList 
                        bookings={bookings} 
                        onReceiptClick={(b) => handleTabChange('documents')} 
                        onCancelClick={setSelectedBookingForCancel} 
                        onRescheduleClick={setSelectedBookingForReschedule} 
                    />
                )}

                {activeTab === 'tracking' && (
                    <ActiveBookingsTracker bookings={bookings} />
                )}

                {activeTab === 'calendar' && (
                    <PortalCalendar bookings={bookings} />
                )}

                {activeTab === 'documents' && (
                    <DocumentsSection bookings={bookings} customerData={customerData} />
                )}

                {activeTab === 'resources' && (
                    <CustomerPortalResourcesPage />
                )}

                {activeTab === 'profile' && (
                    <ProfileManagement customer={customerData} onUpdate={() => fetchData(false)} />
                )}

                {activeTab === 'verification' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-white mb-1">Identity Verification</h2>
                            <p className="text-sm text-blue-200">Manage your driver's license and vehicle details securely.</p>
                        </div>
                        <VerificationManager customer={customerData} onUpdate={() => fetchData(false)} />
                    </div>
                )}

                {activeTab === 'messages' && (
                    <CommunicationHub 
                        customer={customerData} 
                        bookings={bookings} 
                        notes={notes} 
                        onNewNote={(n) => setNotes(prev => [...prev, n])} 
                        onRefreshData={() => fetchData(false)} 
                    />
                )}
            </div>

            {selectedBookingForCancel && (
                <CancelDialog 
                    booking={selectedBookingForCancel} 
                    isOpen={!!selectedBookingForCancel} 
                    onOpenChange={() => setSelectedBookingForCancel(null)}
                    onUpdate={() => fetchData(false)}
                />
            )}

            {selectedBookingForReschedule && (
                <RescheduleDialog
                    booking={selectedBookingForReschedule}
                    isOpen={!!selectedBookingForReschedule}
                    onOpenChange={() => setSelectedBookingForReschedule(null)}
                    onUpdate={() => fetchData(false)}
                />
            )}

        </div>
    );
}
