import React, { useState, useEffect, useCallback, useMemo } from 'react';
    import { useParams, Link, useSearchParams } from 'react-router-dom';
    import { motion } from 'framer-motion';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { Loader2, ArrowLeft, User, Clock, DollarSign, ShieldAlert, MessageSquare, Bell, AlertTriangle } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { CustomerProfile } from './CustomerProfile';
    import { CommunicationLog } from './CommunicationLog';
    import { ActiveRentals } from './ActiveRentals';
    import { BookingHistory } from './BookingHistory';
    import { CompletedBookings } from './CompletedBookings';
    import { ReceiptDetailDialog } from '@/components/admin/ReceiptDetailDialog';
    import { ComprehensiveHistoryDialog } from './ComprehensiveHistoryDialog';
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    import { CustomerVerification } from './CustomerVerification';
    import { CustomerProfileHeader } from './CustomerProfileHeader';

    export const CustomerDetailView = () => {
        const { id } = useParams();
        const [searchParams, setSearchParams] = useSearchParams();
        const [customer, setCustomer] = useState(null);
        const [bookings, setBookings] = useState([]);
        const [equipment, setEquipment] = useState([]);
        const [notes, setNotes] = useState([]);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);
        const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
        const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');
        const [hasUnreadNotes, setHasUnreadNotes] = useState(false);


        const fetchCustomerDetails = useCallback(async (isInitialLoad = true) => {
            if (isInitialLoad) {
                setLoading(true);
                setError(null);
            }
            try {
                const customerPromise = supabase.from('customers').select('*').eq('id', id).single();
                const bookingsPromise = supabase.from('bookings').select('*, stripe_payment_info(*)').eq('customer_id', id).order('created_at', { ascending: false });
                const notesPromise = supabase.from('customer_notes').select('*').eq('customer_id', id).order('created_at', { ascending: true });

                const [{ data: customerData, error: customerError }, { data: bookingsData, error: bookingsError }, { data: notesData, error: notesError }] = await Promise.all([customerPromise, bookingsPromise, notesPromise]);
                
                if (customerError) throw new Error(`Customer fetch error: ${customerError.message}`);
                if (bookingsError) throw new Error(`Bookings fetch error: ${bookingsError.message}`);
                if (notesError) throw new Error(`Notes fetch error: ${notesError.message}`);

                let equipmentData = [];
                if (bookingsData && bookingsData.length > 0) {
                    const bookingIds = bookingsData.map(b => b.id);
                    const { data, error: equipmentError } = await supabase
                        .from('booking_equipment')
                        .select('*, equipment(name, total_quantity)')
                        .in('booking_id', bookingIds);
                    if (equipmentError) throw new Error(`Equipment fetch error: ${equipmentError.message}`);
                    equipmentData = data;
                }
                
                setCustomer(customerData);
                setBookings(bookingsData || []);
                setEquipment(equipmentData || []);
                setNotes(notesData || []);
                setHasUnreadNotes(notesData.some(n => !n.is_read && n.author_type === 'customer'));

            } catch(err) {
                 toast({ title: "Failed to load customer details", description: err.message, variant: "destructive" });
                 setError(err.message);
                 setCustomer(null);
                 setBookings([]);
                 setEquipment([]);
                 setNotes([]);
            } finally {
                if (isInitialLoad) setLoading(false);
            }
        }, [id]);

        useEffect(() => {
            fetchCustomerDetails();
        }, [fetchCustomerDetails]);

        useEffect(() => {
            if (!id) return;

            const notesChannel = supabase.channel(`customer-notes-${id}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_notes', filter: `customer_id=eq.${id}` }, 
                (payload) => {
                    setNotes(currentNotes => [...currentNotes, payload.new]);
                    if (payload.new.author_type === 'customer') {
                        setHasUnreadNotes(true);
                        toast({
                            title: "New Customer Message",
                            description: `You have a new message from ${customer?.name || 'a customer'}.`,
                            action: <Bell className="h-5 w-5 text-yellow-400" />,
                        });
                    }
                })
                .subscribe();

            const bookingsChannel = supabase.channel(`customer-bookings-${id}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${id}` }, () => fetchCustomerDetails(false))
                .subscribe();
            
            const customerChannel = supabase.channel(`customer-profile-${id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'customers', filter: `id=eq.${id}` }, (payload) => {
                    if (payload.new.id.toString() === id) {
                        setCustomer(c => ({ ...c, ...payload.new }));
                        setHasUnreadNotes(payload.new.has_unread_notes);
                    }
                })
                .subscribe();

            return () => {
                supabase.removeChannel(notesChannel);
                supabase.removeChannel(bookingsChannel);
                supabase.removeChannel(customerChannel);
            };
        }, [id, customer?.name, fetchCustomerDetails]);

        useEffect(() => {
            const tab = searchParams.get('tab');
            if (tab) {
                setActiveTab(tab);
            }
        }, [searchParams]);

        const handleTabChange = (value) => {
            setActiveTab(value);
            setSearchParams({ tab: value });
            if (value === 'notes') {
                setHasUnreadNotes(false);
            }
        };


        const { activeBookings, completedBookings, verificationBookings, cancelledBookings } = useMemo(() => {
            if (!bookings) return { activeBookings: [], completedBookings: [], verificationBookings: [], cancelledBookings: [] };
            const active = bookings.filter(b => b.status !== 'Completed' && b.status !== 'flagged' && b.status !== 'Cancelled' && b.status !== 'pending_verification' && b.status !== 'pending_review' && b.status !== 'pending_payment');
            const completed = bookings.filter(b => b.status === 'Completed' || b.status === 'flagged');
            const verification = bookings.filter(b => b.status === 'pending_verification' || b.status === 'pending_review' || b.status === 'pending_payment');
            const cancelled = bookings.filter(b => b.status === 'Cancelled');
            return { activeBookings: active, completedBookings: completed, verificationBookings: verification, cancelledBookings: cancelled };
        }, [bookings]);
        
        if (loading) {
            return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
        }

        if (error) {
            return (
                <div className="container mx-auto py-8 px-4 text-center">
                     <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
                    <h2 className="mt-4 text-2xl font-bold text-red-400">An Error Occurred</h2>
                    <p className="mt-2 text-red-200">Could not load customer data. This might be due to a permissions issue or network problem.</p>
                    <p className="mt-2 font-mono bg-red-900/50 p-4 rounded-md text-sm text-red-200">{error}</p>
                    <Link to="/admin">
                        <Button variant="destructive" className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Button>
                    </Link>
                </div>
            );
        }

        if (!customer) {
            return (
                <div className="text-center py-20">
                    <h2 className="text-2xl font-bold text-red-500">Customer not found</h2>
                    <Link to="/admin?tab=customers">
                        <Button className="mt-4"><ArrowLeft className="mr-2 h-4 w-4" />Back to Customers</Button>
                    </Link>
                </div>
            );
        }

        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="container mx-auto py-8 px-4"
            >
                <Link to="/admin?tab=customers" className="inline-flex items-center mb-6 text-yellow-400 hover:text-yellow-300 transition-colors">
                    <ArrowLeft className="mr-2 h-5 w-5" />
                    Back to Customers
                </Link>

                <CustomerProfileHeader customer={customer} bookingsCount={bookings.length} />

                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full mt-8">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 bg-white/10 text-white mb-6">
                        <TabsTrigger value="profile"><User className="mr-2 h-4 w-4" />Profile</TabsTrigger>
                        <TabsTrigger value="notes" className="relative">
                            <MessageSquare className="mr-2 h-4 w-4" />Chat
                            {hasUnreadNotes && <span className="absolute top-1 right-1 block h-3 w-3 rounded-full bg-red-500 border-2 border-gray-800" />}
                        </TabsTrigger>
                        <TabsTrigger value="verification"><ShieldAlert className="mr-2 h-4 w-4" />Verification</TabsTrigger>
                        <TabsTrigger value="rentals"><Clock className="mr-2 h-4 w-4" />Active Rentals</TabsTrigger>
                        <TabsTrigger value="history"><DollarSign className="mr-2 h-4 w-4" />History & Receipts</TabsTrigger>
                    </TabsList>
                     <TabsContent value="profile">
                         <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                           <CustomerProfile 
                                customer={customer} 
                                setCustomer={setCustomer} 
                                onUpdate={() => fetchCustomerDetails(false)} 
                                onHistoryClick={() => setIsHistoryDialogOpen(true)}
                            />
                        </div>
                    </TabsContent>
                     <TabsContent value="notes">
                        <CommunicationLog customer={customer} initialNotes={notes} onUpdate={() => fetchCustomerDetails(false)} />
                    </TabsContent>
                     <TabsContent value="verification">
                        <div className="space-y-8">
                             <CustomerVerification customer={customer} verificationBookings={verificationBookings} notes={notes} onUpdate={() => fetchCustomerDetails(false)} />
                        </div>
                    </TabsContent>
                    <TabsContent value="rentals">
                        <div className="space-y-8">
                            <ActiveRentals bookings={activeBookings} equipment={equipment} onUpdate={() => fetchCustomerDetails(false)} />
                        </div>
                    </TabsContent>
                    <TabsContent value="history">
                        <BookingHistory bookings={bookings} customer={customer} onReceiptSelect={setSelectedBookingForReceipt} onBookingDeleted={() => fetchCustomerDetails(false)} />
                        <CompletedBookings bookings={[...completedBookings, ...cancelledBookings]} equipment={equipment} />
                    </TabsContent>
                </Tabs>
                
                 <ReceiptDetailDialog 
                    isOpen={!!selectedBookingForReceipt}
                    onOpenChange={(isOpen) => !isOpen && setSelectedBookingForReceipt(null)}
                    booking={selectedBookingForReceipt}
                    equipment={equipment}
                />
                <ComprehensiveHistoryDialog
                    isOpen={isHistoryDialogOpen}
                    onOpenChange={setIsHistoryDialogOpen}
                    customer={customer}
                    bookings={bookings}
                    equipment={equipment}
                    notes={notes}
                />
            </motion.div>
        );
    };