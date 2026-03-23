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
    import { Users, Calendar, DollarSign, Wrench, Truck, AlertTriangle, Star, Loader2, Bell, HelpCircle } from 'lucide-react';
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
    
        const actionItemCount = (bookings.filter(b => ['pending_verification', 'pending_review', 'flagged', 'pending_payment'].includes(b.status)).length) + customersWithUnreadNotes.length;
    
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
                        <TabsList className="grid w-full grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 mb-4 bg-gray-800 p-2 rounded-lg">
                            <TabsTrigger value="action-items" className="relative">
                                <AlertTriangle className="w-4 h-4 mr-2" /> Action Items
                                {actionItemCount > 0 && (
                                    <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                                        {actionItemCount}
                                    </span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="bookings"><Truck className="w-4 h-4 mr-2" />Bookings</TabsTrigger>
                            <TabsTrigger value="customers"><Users className="w-4 h-4 mr-2" />Customers</TabsTrigger>
                            <TabsTrigger value="availability"><Calendar className="w-4 h-4 mr-2" />Availability</TabsTrigger>
                            <TabsTrigger value="pricing"><DollarSign className="w-4 h-4 mr-2" />Pricing/Coupons</TabsTrigger>
                            <TabsTrigger value="equipment"><Wrench className="w-4 h-4 mr-2" />Equipment</TabsTrigger>
                            <TabsTrigger value="reviews"><Star className="w-4 h-4 mr-2" />Reviews</TabsTrigger>
                            <TabsTrigger value="faqs"><HelpCircle className="w-4 h-4 mr-2" />FAQs</TabsTrigger>
                        </TabsList>
                        
                        {loading ? (
                            <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>
                        ) : (
                            <>
                                <TabsContent value="action-items"><ActionItemsManager bookings={bookings} customersWithUnreadNotes={customersWithUnreadNotes} /></TabsContent>
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