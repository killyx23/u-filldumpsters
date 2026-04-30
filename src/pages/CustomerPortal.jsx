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
import AccessCodesPage from '@/pages/AccessCodesPage';

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

    // Magic link handler
    useEffect(() => {
        const handleMagicLink = async () => {
            const token = searchParams.get('token');
            
            if (token && !user && !authLoading) {
                console.log('[CustomerPortal] Magic link token detected, validating...');
                
                try {
                    const { data, error } = await supabase.functions.invoke('validate-magic-link-token', {
                        body: { token }
                    });

                    if (error || !data?.valid) {
                        throw new Error(data?.error || 'Invalid or expired link');
                    }

                    console.log('[CustomerPortal] Magic link validated, logging in customer:', data.customer_id);

                    // Use customer-portal-login to create session
                    const { data: loginData, error: loginError } = await supabase.functions.invoke('customer-portal-login', {
                        body: {
                            portal_number: data.customer.customer_id_text,
                            phone: data.customer.phone
                        }
                    });

                    if (loginError || loginData?.error) {
                        throw new Error(loginData?.error || 'Failed to create session');
                    }

                    if (loginData?.session) {
                        await supabase.auth.setSession(loginData.session);
                        
                        // Remove token from URL and set tab to access-codes
                        setSearchParams({ tab: 'access-codes' });
                        setActiveTab('access-codes');
                        
                        toast({
                            title: 'Login Successful',
                            description: 'Welcome! Redirecting to your access codes...'
                        });
                    }

                } catch (err) {
                    console.error('[CustomerPortal] Magic link error:', err);
                    toast({
                        title: 'Invalid Link',
                        description: err.message || 'This link has expired or is invalid. Please log in manually.',
                        variant: 'destructive'
                    });
                    
                    // Clear invalid token from URL
                    setSearchParams({});
                }
            }
        };

        handleMagicLink();
    }, [searchParams, user, authLoading]);

    // Initialization & Params logic
    useEffect(() => {
        const pid = searchParams.get('portal_id');
        const ph = searchParams.get('phone');
        
        console.log('[CustomerPortal] URL params detected:', { portal_id: pid, phone: ph });
        
        if (pid) setLoginPortalId(pid);
        if (ph) setLoginPhone(ph);
    }, [searchParams]);

    const handleTabChange = (tabId) => {
        console.log('[CustomerPortal] Tab changed to:', tabId);
        setActiveTab(tabId);
        setSearchParams({ tab: tabId });
    };

    // ENHANCED: Fetch data with comprehensive logging
    const fetchData = useCallback(async (isInitialLoad = true) => {
        const timestamp = new Date().toISOString();
        
        if (!user || !session) {
            console.log(`[${timestamp}] [CustomerPortal] No user/session, skipping fetch`, {
                hasUser: !!user,
                hasSession: !!session
            });
            if (isInitialLoad) setLoading(false);
            return;
        }

        console.log(`[${timestamp}] [CustomerPortal] Starting data fetch`, {
            isInitialLoad,
            userId: user.id,
            userEmail: user.email,
            metadata: user.user_metadata
        });

        if (isInitialLoad) setLoading(true);

        const customerDbId = user.user_metadata?.customer_db_id;
        
        console.log(`[${timestamp}] [CustomerPortal] Customer DB ID from metadata:`, customerDbId);

        if (!customerDbId) {
            console.error(`[${timestamp}] [CustomerPortal] ⚠ Missing customer_db_id in user metadata`, {
                fullMetadata: user.user_metadata
            });
            
            toast({ 
                title: "Authentication Error", 
                description: "Could not find your profile. Please try logging in again.", 
                variant: "destructive" 
            });
            
            if (isInitialLoad) setLoading(false);
            await signOut();
            return;
        }

        try {
            console.log(`[${timestamp}] [CustomerPortal] Calling get-customer-details edge function...`);

            const { data, error } = await supabase.functions.invoke('get-customer-details', {
                body: { customerId: customerDbId }
            });

            console.log(`[${timestamp}] [CustomerPortal] Edge function response:`, {
                hasData: !!data,
                hasError: !!error,
                error,
                customerFound: !!data?.customer,
                bookingsCount: data?.bookings?.length,
                notesCount: data?.notes?.length
            });

            if (error) {
                console.error(`[${timestamp}] [CustomerPortal] Edge function error:`, error);
                throw new Error(error.message);
            }

            if (data.error) {
                console.error(`[${timestamp}] [CustomerPortal] API error:`, data.error);
                throw new Error(data.error);
            }

            console.log(`[${timestamp}] [CustomerPortal] ✓ Data loaded successfully`, {
                customerId: data.customer?.id,
                customerEmail: data.customer?.email,
                bookingsCount: data.bookings?.length,
                notesCount: data.notes?.length
            });

            setCustomerData(data.customer);
            setBookings(data.bookings || []);
            setNotes(data.notes || []);
            setLastUpdated(new Date());

        } catch (error) {
            const errorTimestamp = new Date().toISOString();
            console.error(`[${errorTimestamp}] [CustomerPortal] Fetch error:`, {
                error,
                message: error.message,
                stack: error.stack
            });

            toast({ 
                title: "Failed to load data", 
                description: error.message, 
                variant: "destructive" 
            });
        } finally {
            if (isInitialLoad) setLoading(false);
        }
    }, [user, session, signOut]);

    // Initial fetch
    useEffect(() => {
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] [CustomerPortal] Auth state check:`, {
            authLoading,
            hasUser: !!user,
            hasSession: !!session
        });

        if (!authLoading) {
            if (user && session) {
                console.log(`[${timestamp}] [CustomerPortal] User authenticated, fetching data...`);
                fetchData();
            } else {
                console.log(`[${timestamp}] [CustomerPortal] No user/session, showing login`);
                setLoading(false);
            }
        }
    }, [user, session, authLoading, fetchData]);

    // Auto-refresh interval (30 seconds)
    useEffect(() => {
        if (!user || !session) return;
        
        console.log('[CustomerPortal] Setting up auto-refresh interval (30s)');
        
        const intervalId = setInterval(() => {
            console.log('[CustomerPortal] Auto-refresh triggered');
            fetchData(false);
        }, 30000);

        return () => {
            console.log('[CustomerPortal] Cleaning up auto-refresh interval');
            clearInterval(intervalId);
        };
    }, [user, session, fetchData]);

    // Real-time subscriptions
    useEffect(() => {
        if (!customerData) {
            console.log('[CustomerPortal] No customer data, skipping realtime subscriptions');
            return;
        }
        
        console.log('[CustomerPortal] Setting up realtime subscriptions for customer:', customerData.id);

        const channel = supabase.channel(`customer-portal-realtime-${customerData.id}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'customer_notes', 
                filter: `customer_id=eq.${customerData.id}` 
            }, (payload) => {
                console.log('[CustomerPortal] New note received:', payload);
                setNotes(prev => [...prev, payload.new]);
                if (payload.new.author_type === 'admin') {
                    toast({ title: "New Message", description: "You have a new message from support." });
                }
            })
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'bookings', 
                filter: `customer_id=eq.${customerData.id}` 
            }, (payload) => {
                console.log('[CustomerPortal] Booking change detected:', payload);
                fetchData(false);
                toast({ title: "Update", description: "A booking status has changed." });
            })
            .subscribe();

        return () => {
            console.log('[CustomerPortal] Cleaning up realtime subscriptions');
            supabase.removeChannel(channel);
        };
    }, [customerData, fetchData]);

    // ENHANCED: Login with comprehensive logging and retry logic
    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] [CustomerPortal] Login attempt initiated`, {
            portal_number: loginPortalId,
            phone: loginPhone
        });

        setIsLoggingIn(true);

        try {
            console.log(`[${timestamp}] [CustomerPortal] Calling customer-portal-login edge function...`);

            const { data, error } = await supabase.functions.invoke('customer-portal-login', {
                body: { 
                    portal_number: loginPortalId, 
                    phone: loginPhone 
                }
            });

            console.log(`[${timestamp}] [CustomerPortal] Login response:`, {
                hasData: !!data,
                hasError: !!error,
                error,
                hasSession: !!data?.session,
                dataError: data?.error
            });

            if (error) {
                console.error(`[${timestamp}] [CustomerPortal] Edge function error:`, error);
                throw error;
            }

            if (data?.error) {
                console.error(`[${timestamp}] [CustomerPortal] Login failed:`, data.error);
                throw new Error(data.error);
            }

            if (data?.session) {
                console.log(`[${timestamp}] [CustomerPortal] ✓ Login successful, setting session...`);
                
                await supabase.auth.setSession(data.session);
                
                console.log(`[${timestamp}] [CustomerPortal] Session set, reloading page...`);
                window.location.reload();
            } else {
                console.error(`[${timestamp}] [CustomerPortal] Invalid response - no session`);
                throw new Error("Invalid response from server.");
            }

        } catch (err) {
            const errorTimestamp = new Date().toISOString();
            console.error(`[${errorTimestamp}] [CustomerPortal] Login error:`, {
                error: err,
                message: err.message,
                stack: err.stack
            });

            toast({ 
                title: 'Login Failed', 
                description: err.message || 'Invalid credentials. Please check your Portal ID and phone number.', 
                variant: 'destructive' 
            });
        } finally {
            setIsLoggingIn(false);
        }
    };

    // Handler for reschedule - receives booking object, stores booking ID
    const handleRescheduleClick = (booking) => {
        console.log('[CustomerPortal] Reschedule clicked for booking:', booking?.id);
        if (booking && booking.id) {
            setSelectedBookingForReschedule(booking.id);
        }
    };

    if (loading || authLoading) {
        console.log('[CustomerPortal] Rendering loading state');
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
            </div>
        );
    }

    if (!user || !session || !customerData) {
        console.log('[CustomerPortal] Rendering login form', {
            hasUser: !!user,
            hasSession: !!session,
            hasCustomerData: !!customerData
        });

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
                                <Input 
                                    id="portal_id" 
                                    value={loginPortalId} 
                                    onChange={(e) => setLoginPortalId(e.target.value)} 
                                    placeholder="CID-123456" 
                                    required 
                                    className="bg-black/30 border-white/10 text-white placeholder:text-gray-500" 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-gray-300">Phone Number</Label>
                                <Input 
                                    id="phone" 
                                    value={loginPhone} 
                                    onChange={(e) => setLoginPhone(e.target.value)} 
                                    placeholder="(555) 123-4567" 
                                    required 
                                    className="bg-black/30 border-white/10 text-white placeholder:text-gray-500" 
                                />
                            </div>
                            <Button 
                                type="submit" 
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4 py-6 text-lg" 
                                disabled={isLoggingIn}
                            >
                                {isLoggingIn ? (
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                ) : (
                                    <Key className="mr-2 h-5 w-5" />
                                )} 
                                Access Portal
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        );
    }

    console.log('[CustomerPortal] Rendering portal content for tab:', activeTab);

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
                    <PortalDashboard 
                        bookings={bookings} 
                        customerData={customerData} 
                        lastUpdated={lastUpdated} 
                        onRefresh={() => fetchData(true)} 
                    />
                )}

                {activeTab === 'access-codes' && (
                    <AccessCodesPage customerData={customerData} />
                )}
                
                {activeTab === 'bookings' && (
                    <BookingsList 
                        bookings={bookings} 
                        onReceiptClick={(b) => handleTabChange('documents')} 
                        onCancelClick={setSelectedBookingForCancel} 
                        onRescheduleClick={handleRescheduleClick}
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
                    open={!!selectedBookingForReschedule}
                    onClose={() => setSelectedBookingForReschedule(null)}
                    bookingId={selectedBookingForReschedule}
                    onSuccess={() => fetchData(false)}
                />
            )}

        </div>
    );
}