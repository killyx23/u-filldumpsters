
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { CustomersManager } from '@/components/admin/CustomersManager';
import { PricingManager } from '@/components/admin/PricingManager';
import { AvailabilityManager } from '@/components/admin/AvailabilityManager';
import { EquipmentManager } from '@/components/admin/EquipmentManager';
import { ActionItemsManager } from '@/components/admin/ActionItemsManager';
import { ReviewsManager } from '@/components/admin/ReviewsManager';
import { FaqsManager } from '@/components/admin/FaqsManager';
import { PendingVerificationsManager } from '@/components/admin/PendingVerificationsManager';
import { Users, Calendar, DollarSign, Wrench, Truck, AlertTriangle, Star, Loader2, Bell, HelpCircle, MapPin } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';

const AdminDashboard = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || "action-items");
    
    const [bookings, setBookings] = useState([]);
    const [customersWithUnreadNotes, setCustomersWithUnreadNotes] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchDashboardData = useCallback(async (showLoading = true) => {
        if(showLoading) setLoading(true);
        try {
            const bookingsPromise = supabase
                .from('bookings')
                .select('*, customers!inner(*)');

            const unreadNotesPromise = supabase
                .from('customers')
                .select('*')
                .eq('has_unread_notes', true);

            const [{ data: bookingsData, error: bookingsError }, { data: unreadNotesData, error: unreadNotesError }] = await Promise.all([bookingsPromise, unreadNotesPromise]);

            if (bookingsError) throw bookingsError;
            if (unreadNotesError) throw unreadNotesError;

            setBookings(bookingsData || []);
            setCustomersWithUnreadNotes(unreadNotesData || []);

        } catch (error) {
            toast({
                title: "Error fetching dashboard data",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            if(showLoading) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);
    
    useEffect(() => {
        const handleCustomerUpdate = (payload) => {
            if(payload.new.has_unread_notes) {
                setCustomersWithUnreadNotes(prev => {
                    if (!prev.find(c => c.id === payload.new.id)) {
                       return [...prev, payload.new];
                    }
                    return prev;
                });
            } else {
                setCustomersWithUnreadNotes(prev => prev.filter(c => c.id !== payload.new.id));
            }
        };

        const handleNewNote = (payload) => {
            if(payload.new.author_type === 'customer') {
                supabase.from('customers').select('id, name, has_unread_notes').eq('id', payload.new.customer_id).single().then(({data: customer}) => {
                    if(customer && customer.has_unread_notes) {
                         setCustomersWithUnreadNotes(prev => {
                            if (!prev.find(c => c.id === customer.id)) {
                               return [...prev, customer];
                            }
                            return prev;
                        });
                         toast({
                            title: "New Customer Message",
                            description: `A new message has been received from ${customer.name || 'a customer'}.`,
                            action: <Bell className="h-5 w-5 text-yellow-400" />,
                        });
                    }
                });
            }
        };

        const subscription = supabase.channel('admin-dashboard-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => fetchDashboardData(false))
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'customers' }, handleCustomerUpdate)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_notes' }, handleNewNote)
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [fetchDashboardData]);

    const handleSignOut = async () => {
        await signOut();
    };

    const handleTabChange = (value) => {
        setActiveTab(value);
        setSearchParams({ tab: value });
    };

    const pendingAddressCount = bookings.filter(b => b.pending_address_verification).length;
    const actionItemCount = (bookings.filter(b => ['pending_verification', 'pending_review', 'flagged', 'pending_payment'].includes(b.status) && !b.pending_address_verification).length) + customersWithUnreadNotes.length;

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
            <div className="container mx-auto">
                <div className="flex flex-wrap justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-yellow-400">Admin Dashboard</h1>
                    {user && (
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-gray-400 hidden sm:inline">{user.email}</span>
                            <button onClick={handleSignOut} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition-colors">
                                Sign Out
                            </button>
                        </div>
                    )}
                </div>

                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-4 sm:grid-cols-4 lg:grid-cols-9 mb-4 bg-gray-800 p-2 rounded-lg gap-1 h-auto">
                        <TabsTrigger value="action-items" className="relative py-2">
                            <AlertTriangle className="w-4 h-4 mr-1 lg:mr-2" /> <span className="hidden lg:inline">Action Items</span>
                            {actionItemCount > 0 && (
                                <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow">
                                    {actionItemCount}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="pending-address" className="relative py-2 bg-orange-900/20 data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                            <MapPin className="w-4 h-4 mr-1 lg:mr-2" /> <span className="hidden lg:inline">Verify Address</span>
                            {pendingAddressCount > 0 && (
                                <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-xs text-white shadow border border-gray-900">
                                    {pendingAddressCount}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="bookings" className="py-2"><Truck className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Bookings</span></TabsTrigger>
                        <TabsTrigger value="customers" className="py-2"><Users className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Customers</span></TabsTrigger>
                        <TabsTrigger value="availability" className="py-2"><Calendar className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Availability</span></TabsTrigger>
                        <TabsTrigger value="pricing" className="py-2"><DollarSign className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Pricing</span></TabsTrigger>
                        <TabsTrigger value="equipment" className="py-2"><Wrench className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Equipment</span></TabsTrigger>
                        <TabsTrigger value="reviews" className="py-2"><Star className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">Reviews</span></TabsTrigger>
                        <TabsTrigger value="faqs" className="py-2"><HelpCircle className="w-4 h-4 mr-1 lg:mr-2" /><span className="hidden lg:inline">FAQs</span></TabsTrigger>
                    </TabsList>
                    
                    {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>
                    ) : (
                        <>
                            <TabsContent value="action-items"><ActionItemsManager bookings={bookings} customersWithUnreadNotes={customersWithUnreadNotes} /></TabsContent>
                            <TabsContent value="pending-address"><PendingVerificationsManager /></TabsContent>
                            <TabsContent value="bookings"><BookingsManager initialBookings={bookings} /></TabsContent>
                            <TabsContent value="customers"><CustomersManager /></TabsContent>
                            <TabsContent value="availability"><AvailabilityManager /></TabsContent>
                            <TabsContent value="pricing"><PricingManager /></TabsContent>
                            <TabsContent value="equipment"><EquipmentManager /></TabsContent>
                            <TabsContent value="reviews"><ReviewsManager /></TabsContent>
                            <TabsContent value="faqs"><FaqsManager /></TabsContent>
                        </>
                    )}
                </Tabs>
            </div>
        </div>
    );
};

export default AdminDashboard;
