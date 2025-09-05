import React, { useState, useEffect, useCallback, useMemo } from 'react';
    import { useParams, Link, useSearchParams } from 'react-router-dom';
    import { motion } from 'framer-motion';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { Loader2, ArrowLeft, User, Clock, DollarSign, UserCheck, ShieldAlert, MessageSquare } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { CustomerProfile } from './CustomerProfile';
    import { CustomerNotes } from './CustomerNotes';
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
        const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);
        const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
        const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');


        const fetchCustomerDetails = useCallback(async () => {
            setLoading(true);
            try {
                const customerPromise = supabase.from('customers').select('*').eq('id', id).single();
                const bookingsPromise = supabase.from('bookings').select('*, stripe_payment_info(*)').eq('customer_id', id).order('created_at', { ascending: false });
                const notesPromise = supabase.from('customer_notes').select('*').eq('customer_id', id).order('created_at', { ascending: false });

                const [{ data: customerData, error: customerError }, { data: bookingsData, error: bookingsError }, { data: notesData, error: notesError }] = await Promise.all([customerPromise, bookingsPromise, notesPromise]);
                
                if (customerError) throw customerError;
                if (bookingsError) throw bookingsError;
                if (notesError) throw notesError;

                let equipmentData = [];
                if (bookingsData && bookingsData.length > 0) {
                    const bookingIds = bookingsData.map(b => b.id);
                    const { data, error: equipmentError } = await supabase
                        .from('booking_equipment')
                        .select('*, equipment(name, total_quantity)')
                        .in('booking_id', bookingIds);
                    if (equipmentError) throw equipmentError;
                    equipmentData = data;
                }
                
                setCustomer(customerData);
                setBookings(bookingsData || []);
                setEquipment(equipmentData || []);
                setNotes(notesData || []);

            } catch(error) {
                 toast({ title: "Failed to load customer details", description: error.message, variant: "destructive" });
                 setCustomer(null);
                 setBookings([]);
                 setEquipment([]);
                 setNotes([]);
            } finally {
                setLoading(false);
            }
        }, [id]);

        useEffect(() => {
            fetchCustomerDetails();
        }, [fetchCustomerDetails]);

        useEffect(() => {
            const tab = searchParams.get('tab');
            if (tab) {
                setActiveTab(tab);
            }
        }, [searchParams]);

        const handleTabChange = (value) => {
            setActiveTab(value);
            setSearchParams({ tab: value });
        };


        const { activeBookings, completedBookings, verificationBookings, cancelledBookings } = useMemo(() => {
            if (!bookings) return { activeBookings: [], completedBookings: [], verificationBookings: [], cancelledBookings: [] };
            const active = bookings.filter(b => b.status !== 'Completed' && b.status !== 'flagged' && b.status !== 'Cancelled' && b.status !== 'pending_verification' && b.status !== 'pending_review');
            const completed = bookings.filter(b => b.status === 'Completed' || b.status === 'flagged');
            const verification = bookings.filter(b => b.status === 'pending_verification' || b.status === 'pending_review');
            const cancelled = bookings.filter(b => b.status === 'Cancelled');
            return { activeBookings: active, completedBookings: completed, verificationBookings: verification, cancelledBookings: cancelled };
        }, [bookings]);
        
        if (loading) {
            return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
        }

        if (!customer) {
            return (
                <div className="text-center py-20">
                    <h2 className="text-2xl font-bold text-red-500">Customer not found</h2>
                    <Link to="/admin?tab=customers">
                        <Button className="mt-4"><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Button>
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
                    <TabsList className="grid w-full grid-cols-5 bg-white/10 text-white mb-6">
                        <TabsTrigger value="profile"><User className="mr-2 h-4 w-4" />Profile & Notes</TabsTrigger>
                        <TabsTrigger value="notes"><MessageSquare className="mr-2 h-4 w-4" />Notes</TabsTrigger>
                        <TabsTrigger value="verification"><ShieldAlert className="mr-2 h-4 w-4" />Verification</TabsTrigger>
                        <TabsTrigger value="rentals"><Clock className="mr-2 h-4 w-4" />Active Rentals</TabsTrigger>
                        <TabsTrigger value="history"><DollarSign className="mr-2 h-4 w-4" />History & Receipts</TabsTrigger>
                    </TabsList>
                     <TabsContent value="profile">
                         <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                           <CustomerProfile 
                                customer={customer} 
                                setCustomer={setCustomer} 
                                onUpdate={fetchCustomerDetails} 
                                onHistoryClick={() => setIsHistoryDialogOpen(true)}
                            />
                        </div>
                    </TabsContent>
                     <TabsContent value="notes">
                        <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                           <CustomerNotes customer={customer} notes={notes} setNotes={setNotes} onUpdate={fetchCustomerDetails} loading={loading} />
                        </div>
                    </TabsContent>
                     <TabsContent value="verification">
                        <div className="space-y-8">
                             <CustomerVerification customer={customer} verificationBookings={verificationBookings} onUpdate={fetchCustomerDetails} />
                        </div>
                    </TabsContent>
                    <TabsContent value="rentals">
                        <div className="space-y-8">
                            <ActiveRentals bookings={activeBookings} equipment={equipment} onUpdate={fetchCustomerDetails} />
                            <CompletedBookings bookings={[...completedBookings, ...cancelledBookings]} equipment={equipment} />
                        </div>
                    </TabsContent>
                    <TabsContent value="history">
                        <BookingHistory bookings={bookings} customer={customer} onReceiptSelect={setSelectedBookingForReceipt} />
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