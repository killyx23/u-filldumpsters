
import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { 
  Edit, 
  Eye, 
  Search, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle, 
  PlusCircle, 
  Trash2, 
  MapPin, 
  Clock 
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, parseISO } from 'date-fns';
import { BookingDetails } from './BookingDetails';
import { BookingEditForm } from './BookingEditForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export const BookingsManager = ({ initialBookings }) => {
    const [bookings, setBookings] = useState(initialBookings);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedBooking, setSelectedBooking] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpne] = useState(false);
    const [bookingToDelete, setBookingToDelete] = useState(null);

    React.useEffect(() => {
        setBookings(initialBookings);
    }, [initialBookings]);

    const handleUpdateBooking = async (updatedData) => {
        try {
            const { error } = await supabase
                .from('bookings')
                .update(updatedData)
                .eq('id', selectedBooking.id);

            if (error) throw error;

            setBookings(prev => prev.map(b => b.id === selectedBooking.id ? { ...b, ...updatedData } : b));
            toast({ title: 'Success', description: 'Booking updated successfully' });
            setIsEditMode(false);
            setSelectedBooking(null);
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        }
    };

    const handleDeleteClick = (booking, e) => {
        e.stopPropagation();
        setBookingToDelete(booking);
        setIsDeleteDialogOpne(true);
    };

    const confirmDelete = async () => {
        if (!bookingToDelete) return;

        try {
            const { error } = await supabase
                .from('bookings')
                .delete()
                .eq('id', bookingToDelete.id);

            if (error) throw error;

            setBookings(prev => prev.filter(b => b.id !== bookingToDelete.id));
            toast({ title: 'Success', description: 'Booking deleted successfully' });
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsDeleteDialogOpne(false);
            setBookingToDelete(null);
        }
    };

    const filteredBookings = useMemo(() => {
        return bookings.filter(b => {
            const matchesSearch =
                b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                b.id.toString().includes(searchTerm) ||
                (b.customers?.customer_id_text || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                b.email.toLowerCase().includes(searchTerm.toLowerCase());

            // Added pending_address to the status filter
            const matchesStatus = statusFilter === 'all' 
                ? true 
                : statusFilter === 'pending_address'
                    ? b.pending_address_verification === true
                    : b.status === statusFilter;

            return matchesSearch && matchesStatus;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }, [bookings, searchTerm, statusFilter]);

    const getStatusDisplay = (booking) => {
        if (booking.pending_address_verification) {
            return (
                <span className="flex items-center text-orange-400 bg-orange-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                    <MapPin className="w-3 h-3 mr-1" /> Pending Address
                </span>
            );
        }
        if (booking.status === 'pending_verification') {
            return (
                <span className="flex items-center text-orange-400 bg-orange-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                    <AlertTriangle className="w-3 h-3 mr-1" /> Pending Ver.
                </span>
            );
        }
        if (booking.status === 'pending_review') {
            return (
                <span className="flex items-center text-amber-400 bg-amber-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                    <ShieldAlert className="w-3 h-3 mr-1" /> Manual Review
                </span>
            );
        }
        if (booking.status === 'pending_payment') {
            return (
                <span className="flex items-center text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                    <Clock className="w-3 h-3 mr-1" /> Pending Payment
                </span>
            );
        }
        if (booking.status === 'Confirmed') {
            return (
                <span className="flex items-center text-green-400 bg-green-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                    <CheckCircle className="w-3 h-3 mr-1" /> Confirmed
                </span>
            );
        }
        if (booking.status === 'Cancelled') {
             return <span className="text-red-400 bg-red-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">Cancelled</span>;
        }
        return <span className="text-blue-400 bg-blue-400/10 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">{booking.status}</span>;
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between gap-4 bg-gray-800 p-4 rounded-lg">
                <div className="flex-1 flex gap-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                        <Input
                            placeholder="Search by ID, name, email or CID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px] bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-700 border-gray-600 text-white">
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="Confirmed">Confirmed</SelectItem>
                            <SelectItem value="pending_address">Pending Address</SelectItem>
                            <SelectItem value="pending_verification">Pending Verification</SelectItem>
                            <SelectItem value="pending_review">Manual Review</SelectItem>
                            <SelectItem value="pending_payment">Pending Payment</SelectItem>
                            <SelectItem value="Delivered">Active (Delivered)</SelectItem>
                            <SelectItem value="Completed">Completed</SelectItem>
                            <SelectItem value="Cancelled">Cancelled</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => window.open('/', '_blank')}>
                    <PlusCircle className="mr-2 h-4 w-4" /> New Booking
                </Button>
            </div>

            <div className="bg-gray-800 rounded-lg overflow-hidden overflow-x-auto border border-gray-700">
                <Table>
                    <TableHeader>
                        <TableRow className="border-gray-700 hover:bg-gray-800">
                            <TableHead className="text-gray-300">ID</TableHead>
                            <TableHead className="text-gray-300">Customer</TableHead>
                            <TableHead className="text-gray-300">Service</TableHead>
                            <TableHead className="text-gray-300">Dates</TableHead>
                            <TableHead className="text-gray-300">Status</TableHead>
                            <TableHead className="text-gray-300 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredBookings.map((booking) => (
                            <TableRow key={booking.id} className="border-gray-700 hover:bg-gray-750">
                                <TableCell className="font-medium text-blue-400">#{booking.id}</TableCell>
                                <TableCell>
                                    <div className="font-semibold text-white">{booking.name}</div>
                                    <div className="text-sm text-gray-400">{booking.customers?.customer_id_text}</div>
                                    <div className="text-xs text-gray-500">{booking.email}</div>
                                </TableCell>
                                <TableCell>
                                    <div className="text-gray-200">{booking.plan?.name || 'Unknown'}</div>
                                    {booking.addons?.isDelivery && <div className="text-xs text-blue-400">w/ Delivery</div>}
                                </TableCell>
                                <TableCell>
                                    <div className="text-sm text-gray-300">
                                        Out: {format(parseISO(booking.drop_off_date), 'MMM d, yyyy')}
                                    </div>
                                    <div className="text-sm text-gray-300">
                                        In: {format(parseISO(booking.pickup_date), 'MMM d, yyyy')}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {getStatusDisplay(booking)}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { setSelectedBooking(booking); setIsEditMode(false); }}
                                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/20"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { setSelectedBooking(booking); setIsEditMode(true); }}
                                            className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/20"
                                        >
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => handleDeleteClick(booking, e)}
                                            className="text-red-400 hover:text-red-300 hover:bg-red-400/20"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filteredBookings.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                                    No bookings found matching your criteria.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={!!selectedBooking} onOpenChange={(open) => !open && setSelectedBooking(null)}>
                <DialogContent className="max-w-4xl bg-gray-900 border-gray-700 text-white max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl text-yellow-400">
                            {isEditMode ? 'Edit Booking' : 'Booking Details'} #{selectedBooking?.id}
                        </DialogTitle>
                    </DialogHeader>
                    
                    {selectedBooking && (
                        isEditMode ? (
                            <BookingEditForm
                                booking={selectedBooking}
                                onSave={handleUpdateBooking}
                                onCancel={() => setIsEditMode(false)}
                            />
                        ) : (
                            <BookingDetails
                                booking={selectedBooking}
                                onEdit={() => setIsEditMode(true)}
                            />
                        )
                    )}
                </DialogContent>
            </Dialog>

             <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpne}>
                <DialogContent className="bg-gray-900 border-red-500 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-red-500 flex items-center">
                            <AlertTriangle className="mr-2 h-5 w-5" />
                            Confirm Deletion
                        </DialogTitle>
                        <DialogDescription className="text-gray-300">
                            Are you sure you want to permanently delete Booking #{bookingToDelete?.id}? This action cannot be undone and will remove all associated records including payment history and customer notes tied specifically to this booking.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsDeleteDialogOpne(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={confirmDelete}>Yes, Delete Booking</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
