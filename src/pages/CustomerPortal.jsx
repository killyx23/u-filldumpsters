
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Key, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

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
import { UiControlGuide } from '@/components/UiControlGuide';
import { getPortalGuideEntries } from '@/config/uiControlGuideEntries';
import { ReturningCustomerLoyaltyBadge } from '@/components/ReturningCustomerLoyaltyBadge';
import { PortalLoyaltySummary } from '@/components/customer-portal/PortalLoyaltySummary';
import { PortalReferralsSection } from '@/components/customer-portal/PortalReferralsSection';
import { ReturningCustomerBenefits } from '@/components/ReturningCustomerBenefits';

const isPortalAuthError = (error, data) => {
    const message = String(data?.error || data?.msg || error?.message || '').toLowerCase();
    const errorCode = String(data?.error_code || '').toLowerCase();
    const status = error?.context?.status;
    return (
        message.includes('invalid session') ||
        message.includes('authentication required') ||
        message.includes('unauthorized') ||
        message.includes('user_not_found') ||
        message.includes('sub claim') ||
        message.includes('does not exist') ||
        errorCode === 'user_not_found' ||
        status === 401 ||
        status === 403
    );
};

const clearLocalSession = async () => {
    await supabase.auth.signOut({ scope: 'local' });
};

export const CustomerPortal = () => {
    const { user, loading: authLoading, session } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [loginPortalId, setLoginPortalId] = useState('');
    const [loginPhone, setLoginPhone] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard');

    useEffect(() => {
        const tabFromUrl = searchParams.get('tab');
        if (tabFromUrl) {
            setActiveTab(tabFromUrl);
        }
    }, [searchParams]);
    const [customerData, setCustomerData] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);
    const [selectedBookingForCancel, setSelectedBookingForCancel] = useState(null);
    const [selectedBookingForReschedule, setSelectedBookingForReschedule] = useState(null);
    const autoLoginAttemptedRef = useRef(false);

    const mergeSearchParams = useCallback((updates = {}, options = {}) => {
        const next = new URLSearchParams(searchParams);
        const removeKeys = options.removeKeys || [];

        removeKeys.forEach((key) => next.delete(key));

        Object.entries(updates).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                next.delete(key);
            } else {
                next.set(key, String(value));
            }
        });

        setSearchParams(next);
    }, [searchParams, setSearchParams]);

    const getDeeplinkCredentials = useCallback(() => {
        const portalId =
            searchParams.get('portal_id') ||
            searchParams.get('portal_number') ||
            searchParams.get('cid') ||
            '';
        const phone = searchParams.get('phone') || '';
        return { portalId: portalId.trim(), phone: phone.trim() };
    }, [searchParams]);

    const performPortalLogin = useCallback(async (portalId, phone) => {
        const rawPhone = String(phone).replace(/\D/g, '');
        if (!portalId || rawPhone.length !== 10) {
            throw new Error('Invalid portal credentials.');
        }

        await clearLocalSession();

        const { data, error } = await supabase.functions.invoke('customer-portal-login', {
            body: {
                portal_number: portalId,
                phone: rawPhone,
            },
        });

        if (error) {
            throw error;
        }
        if (data?.error) {
            throw new Error(data.error);
        }
        if (!data?.session) {
            throw new Error('Invalid response from server.');
        }

        const { error: sessionError } = await supabase.auth.setSession(data.session);
        if (sessionError) {
            throw sessionError;
        }

        return data;
    }, []);

    useEffect(() => {
        const handleMagicLink = async () => {
            const token = searchParams.get('token');
            if (!token || authLoading) {
                return;
            }

            if (user) {
                const requestedTab = searchParams.get('tab') || 'access-codes';
                setActiveTab(requestedTab);
                mergeSearchParams({ tab: requestedTab }, { removeKeys: ['token'] });
                return;
            }
            
            console.log('[CustomerPortal] Magic link token detected, validating...');
            
            try {
                const requestedTab = searchParams.get('tab') || 'access-codes';
                const requestedOrderId = searchParams.get('order_id');
                const { data, error } = await supabase.functions.invoke('validate-magic-link-token', {
                    body: { token, order_id: requestedOrderId }
                });

                if (error || !data?.valid) {
                    throw new Error(data?.error || 'Invalid or expired link');
                }

                console.log('[CustomerPortal] Magic link validated, logging in customer:', data.customer_id);

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
                    mergeSearchParams({ tab: requestedTab }, { removeKeys: ['token'] });
                    setActiveTab(requestedTab);
                    
                    toast({
                        title: 'Login Successful',
                        description: 'Welcome! Redirecting to your portal...'
                    });
                }

            } catch (err) {
                console.error('[CustomerPortal] Magic link error:', err);
                toast({
                    title: 'Invalid Link',
                    description: err.message || 'This link has expired or is invalid. Please log in manually.',
                    variant: 'destructive'
                });
                mergeSearchParams({}, { removeKeys: ['token'] });
            }
        };

        handleMagicLink();
    }, [searchParams, user, authLoading, mergeSearchParams]);

    useEffect(() => {
        const pid = searchParams.get('portal_id');
        const pnum = searchParams.get('portal_number');
        const cid = searchParams.get('cid');
        const ph = searchParams.get('phone');
        
        const foundPid = pid || pnum || cid;
        
        console.log('[CustomerPortal] URL params detected:', { foundPid, phone: ph });
        
        if (foundPid) setLoginPortalId(foundPid);
        if (ph) setLoginPhone(ph);
    }, [searchParams]);

    const handleTabChange = (tabId) => {
        console.log('[CustomerPortal] Tab changed to:', tabId);
        setActiveTab(tabId);
        mergeSearchParams({ tab: tabId });
    };

    const fetchData = useCallback(async (isInitialLoad = true) => {
        const timestamp = new Date().toISOString();
        
        if (!user || !session?.access_token) {
            console.log(`[${timestamp}] [CustomerPortal] No user/session token, skipping fetch`, {
                hasUser: !!user,
                hasSession: !!session,
                hasAccessToken: !!session?.access_token,
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

        const parsedId = Number.parseInt(String(customerDbId), 10);
        if (customerDbId === null || customerDbId === undefined || !Number.isFinite(parsedId)) {
            console.error(`[${timestamp}] [CustomerPortal] ⚠ Missing or invalid customer_db_id in user metadata`, {
                fullMetadata: user.user_metadata
            });
            
            toast({ 
                title: "Authentication Error", 
                description: "Invalid booking ID. Please check your login credentials.", 
                variant: "destructive" 
            });
            
            if (isInitialLoad) setLoading(false);
            await clearLocalSession();
            return;
        }

        try {
            console.log(`[${timestamp}] [CustomerPortal] Calling get-customer-details edge function...`);

            const { data, error } = await supabase.functions.invoke('get-customer-details', {
                body: { customerId: parsedId },
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
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
                if (isPortalAuthError(error, null)) {
                    await clearLocalSession();
                    toast({
                        title: 'Session expired',
                        description: 'Please sign in again with your Portal ID and phone number.',
                        variant: 'destructive',
                    });
                    return;
                }
                throw new Error(error.message);
            }

            if (data?.error) {
                console.error(`[${timestamp}] [CustomerPortal] API error:`, data.error);
                if (isPortalAuthError(null, data)) {
                    await clearLocalSession();
                    toast({
                        title: 'Session expired',
                        description: 'Please sign in again with your Portal ID and phone number.',
                        variant: 'destructive',
                    });
                    return;
                }
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

            if (isPortalAuthError(error, null)) {
                await clearLocalSession();
                toast({
                    title: 'Session expired',
                    description: 'Please sign in again with your Portal ID and phone number.',
                    variant: 'destructive',
                });
            } else {
                toast({ 
                    title: "Failed to load data", 
                    description: error.message, 
                    variant: "destructive" 
                });
            }
        } finally {
            if (isInitialLoad) setLoading(false);
        }
    }, [user, session]);

    useEffect(() => {
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] [CustomerPortal] Auth state check:`, {
            authLoading,
            hasUser: !!user,
            hasSession: !!session
        });

        if (authLoading) {
            return;
        }

        const run = async () => {
            const { portalId } = getDeeplinkCredentials();

            if (user && session?.access_token && portalId) {
                const expectedEmail = `${portalId.toLowerCase()}@ufilldumpsters.com`;
                if ((user.email ?? '').toLowerCase() !== expectedEmail) {
                    console.warn('[CustomerPortal] Stale session for different customer, clearing locally');
                    await clearLocalSession();
                    setLoading(false);
                    return;
                }
            }

            if (user && session?.access_token) {
                console.log(`[${timestamp}] [CustomerPortal] User authenticated, fetching data...`);
                fetchData();
            } else {
                console.log(`[${timestamp}] [CustomerPortal] No user/session, showing login`);
                setLoading(false);
            }
        };

        run();
    }, [user, session, authLoading, fetchData, getDeeplinkCredentials]);

    useEffect(() => {
        if (authLoading || user || isLoggingIn) {
            return;
        }

        const { portalId, phone } = getDeeplinkCredentials();
        if (!portalId || !phone || autoLoginAttemptedRef.current) {
            return;
        }

        autoLoginAttemptedRef.current = true;

        const runAutoLogin = async () => {
            setIsLoggingIn(true);
            try {
                console.log('[CustomerPortal] Auto-login from deeplink params');
                await performPortalLogin(portalId, phone);
                const requestedTab = searchParams.get('tab') || 'dashboard';
                mergeSearchParams({ tab: requestedTab }, { removeKeys: ['token'] });
                setActiveTab(requestedTab);
                toast({
                    title: 'Login Successful',
                    description: 'Welcome to your customer portal.',
                });
            } catch (err) {
                console.error('[CustomerPortal] Deeplink auto-login failed:', err);
                autoLoginAttemptedRef.current = false;
                toast({
                    title: 'Login Failed',
                    description: err.message || 'Could not sign in automatically. Use the form below.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoggingIn(false);
            }
        };

        runAutoLogin();
    }, [authLoading, user, isLoggingIn, getDeeplinkCredentials, performPortalLogin, searchParams, mergeSearchParams]);

    useEffect(() => {
        if (!user || !session?.access_token) return;
        
        console.log('[CustomerPortal] Setting up auto-refresh interval (5m)');
        
        const intervalId = setInterval(() => {
            console.log('[CustomerPortal] Auto-refresh triggered');
            fetchData(false);
        }, 5 * 60 * 1000);

        return () => {
            console.log('[CustomerPortal] Cleaning up auto-refresh interval');
            clearInterval(intervalId);
        };
    }, [user, session, fetchData]);

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

    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        const timestamp = new Date().toISOString();
        
        const rawPhone = loginPhone.replace(/\D/g, '');
        
        console.log(`[${timestamp}] [CustomerPortal] Login attempt initiated`, {
            portal_number: loginPortalId,
            phone: rawPhone
        });

        setIsLoggingIn(true);

        try {
            await performPortalLogin(loginPortalId, loginPhone);

            toast({
                title: 'Login Successful',
                description: 'Welcome to your customer portal.',
            });
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

    const handleRescheduleClick = (booking) => {
        console.log('[CustomerPortal] Reschedule clicked for booking:', booking?.id);
        if (booking && booking.id) {
            setSelectedBookingForReschedule(booking.id);
        }
    };

    const handleQuickReorder = (booking) => {
        console.log('[CustomerPortal] Quick reorder clicked for booking:', booking.id);
        navigate('/', { state: { reorderBooking: booking } });
    };

    if (loading || authLoading) {
        console.log('[CustomerPortal] Rendering loading state');
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
            </div>
        );
    }

    if (!user || !session || !customerData?.id) {
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

    // Get last 3 completed bookings for quick reorder
    const recentCompletedBookings = bookings
        .filter(b => b.status && !['cancelled', 'pending_payment'].includes(b.status.toLowerCase()))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);

    return (
        <div className="container mx-auto py-8 px-4 flex flex-col lg:flex-row min-h-[calc(100vh-200px)]">
            
            <PortalNavigation 
                activeTab={activeTab} 
                onTabChange={handleTabChange} 
                hasUnreadMessages={hasUnreadMessages}
                hasPendingVerifications={hasPendingVerifications}
            />

            <div className="flex-1 lg:pl-4 min-w-0">
                {activeTab === 'welcome' && (
                    <div className="space-y-0">
                        <ReturningCustomerLoyaltyBadge
                            customerName={
                                customerData.first_name ||
                                customerData.name?.split(' ')[0] ||
                                'Valued Customer'
                            }
                            bookingCount={
                                bookings.filter(
                                    (b) => b.status === 'Completed' || b.status === 'flagged'
                                ).length
                            }
                        />
                        <PortalLoyaltySummary customerId={customerData.id} />
                        <PortalReferralsSection
                            customerId={customerData.id}
                            customerEmail={customerData.email}
                        />
                        {bookings[0]?.plan_id && (
                            <ReturningCustomerBenefits serviceId={bookings[0].plan_id} />
                        )}
                    </div>
                )}

                {activeTab === 'dashboard' && (
                    <div className="space-y-6">
                        <PortalDashboard 
                            bookings={bookings} 
                            customerData={customerData} 
                            lastUpdated={lastUpdated} 
                            onRefresh={() => fetchData(true)}
                            onNavigateToTab={handleTabChange}
                        />

                        {/* Quick Reorder Section */}
                        {recentCompletedBookings.length > 0 && (
                            <Card className="bg-white/10 backdrop-blur-md border-white/20 shadow-xl">
                                <CardHeader>
                                    <CardTitle className="text-white flex items-center gap-2">
                                        <RotateCcw className="h-6 w-6 text-green-400" />
                                        Quick Reorder
                                    </CardTitle>
                                    <CardDescription className="text-blue-200">
                                        Order again from your recent bookings
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {recentCompletedBookings.map(booking => (
                                            <div 
                                                key={booking.id} 
                                                className="bg-black/20 p-4 rounded-lg border border-white/10 hover:border-green-500/50 transition-all group"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1">
                                                        <p className="text-white font-semibold">
                                                            {booking.plan?.name || 'Service'}
                                                        </p>
                                                        <p className="text-sm text-blue-200">
                                                            {format(new Date(booking.created_at), 'MMMM d, yyyy')}
                                                        </p>
                                                        <p className="text-xs text-gray-400 mt-1">
                                                            ${Number(booking.total_price || 0).toFixed(2)}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        onClick={() => handleQuickReorder(booking)}
                                                        className="bg-green-600 hover:bg-green-700 text-white"
                                                    >
                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                        Reorder
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="w-full mt-4 border-white/30 text-white hover:bg-white/10"
                                        onClick={() => handleTabChange('bookings')}
                                    >
                                        View Full Booking History
                                    </Button>
                                </CardContent>
                            </Card>
                        )}
                    </div>
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
                    <ProfileManagement
                        customer={customerData}
                        onUpdate={() => fetchData(false)}
                        onNavigateToTab={handleTabChange}
                    />
                )}

                {activeTab === 'verification' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-white mb-1">Identity Verification</h2>
                            <p className="text-sm text-blue-200">Manage your driver's license, auto insurance, and vehicle details securely.</p>
                        </div>
                        <VerificationManager
                            customer={customerData}
                            bookings={bookings}
                            onUpdate={() => fetchData(false)}
                        />
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
                <UiControlGuide
                    variant="compact"
                    stepTitle="Customer Portal"
                    entries={getPortalGuideEntries()}
                    className="mt-6 flex justify-end"
                />
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
};

export default CustomerPortal;
