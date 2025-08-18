import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, ArrowLeft, User, Edit, Clock, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerProfile } from './CustomerProfile';
import { CustomerNotes } from './CustomerNotes';
import { ActiveRentals } from './ActiveRentals';
import { BookingHistory } from './BookingHistory';
import { CompletedBookings } from './CompletedBookings';
import { ReceiptDetailDialog } from '@/components/admin/ReceiptDetailDialog';

const DetailCard = ({ icon, title, children }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg">
        <div className="flex items-center mb-4">
            {icon}
            <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
        </div>
        {children}
    </div>
);

export const CustomerDetailView = () => {
    const { id } = useParams();
    const [customer, setCustomer] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [equipment, setEquipment] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);

    const fetchCustomerDetails = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.functions.invoke('get-customer-details', {
            body: { customerId: id }
        });

        if (error) {
            toast({ title: "Failed to load customer details", description: error.message, variant: "destructive" });
            setLoading(false);
            return;
        } 
        
        setCustomer(data.customer);
        setBookings(data.bookings.sort((a, b) => new Date(b.drop_off_date) - new Date(a.drop_off_date)));
        setEquipment(data.equipment);
        setLoading(false);
    }, [id]);

    useEffect(() => {
        fetchCustomerDetails();
    }, [fetchCustomerDetails]);

    const { activeBookings, completedBookings } = useMemo(() => {
        const active = bookings.filter(b => b.status !== 'Completed' && b.status !== 'flagged' && b.status !== 'Cancelled');
        const completed = bookings.filter(b => b.status === 'Completed' || b.status === 'flagged');
        return { activeBookings: active, completedBookings: completed };
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-8">
                    <DetailCard icon={<User className="h-6 w-6 text-yellow-400" />} title="Customer Profile">
                        <CustomerProfile customer={customer} setCustomer={setCustomer} bookingsCount={bookings.length} />
                    </DetailCard>
                    <DetailCard icon={<Edit className="h-6 w-6 text-yellow-400" />} title="Notes">
                       <CustomerNotes customer={customer} setCustomer={setCustomer} />
                    </DetailCard>
                </div>
                <div className="lg:col-span-2 space-y-8">
                    <ActiveRentals bookings={activeBookings} equipment={equipment} onUpdate={fetchCustomerDetails} />
                    <CompletedBookings bookings={completedBookings} equipment={equipment} />
                    <BookingHistory bookings={bookings} customer={customer} onReceiptSelect={setSelectedBookingForReceipt} />
                </div>
            </div>
             <ReceiptDetailDialog 
                isOpen={!!selectedBookingForReceipt}
                onOpenChange={(isOpen) => !isOpen && setSelectedBookingForReceipt(null)}
                booking={selectedBookingForReceipt}
                equipment={equipment}
            />
        </motion.div>
    );
};