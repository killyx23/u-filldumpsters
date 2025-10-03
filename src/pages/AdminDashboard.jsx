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
import { Users, Calendar, DollarSign, Wrench, Truck, AlertTriangle, Star, Loader2, Bell } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { startOfMonth, endOfMonth, formatISO } from 'date-fns';

const AdminDashboard = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || "action-items");
    const [actionItemCount, setActionItemCount] = useState(0);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        try {
            const monthStart = formatISO(startOfMonth(new Date()), { representation: 'date' });
            const monthEnd = formatISO(endOfMonth(new Date()), { representation: 'date' });

            const { data: bookingsData, error: bookingsError } = await supabase
                .from('bookings')
                .select('*, customers!inner(*)')
                .gte('drop_off_date', monthStart)
                .lte('drop_off_date', monthEnd);

            if (bookingsError) throw bookingsError;
            setBookings(bookingsData || []);

            const { count: flaggedCount, error: flaggedError } = await supabase
                .from('bookings')
                .select('id', { count: 'exact', head: true })
                .in('status', ['pending_verification', 'pending_review', 'flagged']);

            if (flaggedError) throw flaggedError;

            const { count: notesCount, error: notesError } = await supabase
                .from('customers')
                .select('id', { count: 'exact', head: true })
                .eq('has_unread_notes', true);
            
            if (notesError) throw notesError;

            setActionItemCount((flaggedCount || 0) + (notesCount || 0));

        } catch (error) {
            toast({
                title: "Error fetching dashboard data",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    useEffect(() => {
        const handleDatabaseChange = (payload) => {
            let shouldRefetch = false;
            if (payload.table === 'bookings') {
                shouldRefetch = true;
            }
            if (payload.table === 'customers' && payload.eventType === 'UPDATE') {
                if (payload.old.has_unread_notes !== payload.new.has_unread_notes) {
                    shouldRefetch = true;
                }
            }
            if (payload.table === 'customer_notes' && payload.eventType === 'INSERT') {
                shouldRefetch = true;
                if (payload.new.author_type === 'customer') {
                     toast({
                        title: "New Customer Message",
                        description: `A new message has been received.`,
                        action: <Bell className="h-5 w-5 text-yellow-400" />,
                    });
                }
            }

            if (shouldRefetch) {
                fetchDashboardData();
            }
        };

        const subscription = supabase.channel('admin-dashboard-realtime')
            .on('postgres_changes', { event: '*', schema: 'public' }, handleDatabaseChange)
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [fetchDashboardData]);

    const handleSignOut = async () => {
        await signOut();
        navigate('/admin/login');
    };

    const handleTabChange = (value) => {
        setActiveTab(value);
        setSearchParams({ tab: value });
    };

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
                    <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 mb-4 bg-gray-800 p-2 rounded-lg">
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
                    </TabsList>
                    
                    {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>
                    ) : (
                        <>
                            <TabsContent value="action-items"><ActionItemsManager bookings={bookings} setActiveTab={setActiveTab} /></TabsContent>
                            <TabsContent value="bookings"><BookingsManager initialBookings={bookings} /></TabsContent>
                            <TabsContent value="customers"><CustomersManager /></TabsContent>
                            <TabsContent value="availability"><AvailabilityManager /></TabsContent>
                            <TabsContent value="pricing"><PricingManager /></TabsContent>
                            <TabsContent value="equipment"><EquipmentManager /></TabsContent>
                            <TabsContent value="reviews"><ReviewsManager /></TabsContent>
                        </>
                    )}
                </Tabs>
            </div>
        </div>
    );
};

export default AdminDashboard;