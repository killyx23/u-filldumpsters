
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from '@/components/ui/use-toast';
import { Loader2, LogOut, FileText, Image as ImageIcon, MessageSquare, Send, UploadCloud, Download, Calendar, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { format, parseISO, isSameDay } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { useNavigate } from 'react-router-dom';
import BackButton from '@/components/BackButton';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";

const Section = ({ title, icon, children, className = '' }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 ${className}`}
    >
        <h2 className="flex items-center text-2xl font-bold text-yellow-400 mb-4">{icon}{title}</h2>
        <div className="space-y-4">{children}</div>
    </motion.div>
);

const BookingCard = ({ booking, customer, onAddNoteClick }) => {
    const receiptRef = useRef();
    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Receipt-${booking.id}`,
    });

    const isActive = booking.status !== 'Completed' && booking.status !== 'Cancelled';

    return (
        <div className="bg-white/5 p-4 rounded-lg">
             <div className="hidden">
                 <PrintableReceipt ref={receiptRef} booking={{ ...booking, customers: customer }} />
            </div>
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-bold text-lg text-white">{booking.plan.name}</p>
                    <p className="text-sm text-blue-200">{format(parseISO(booking.drop_off_date), 'PPP')} - {format(parseISO(booking.pickup_date), 'PPP')}</p>
                </div>
                <StatusBadge status={booking.status} />
            </div>
            <div className="flex justify-end space-x-2 mt-2">
                <Button size="sm" variant="outline" onClick={handlePrint}>Receipt</Button>
                {isActive && <Button size="sm" onClick={() => onAddNoteClick(booking)}>Add Note</Button>}
            </div>
        </div>
    );
};

export default function CustomerPortal() {
    const { user, signOut, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [customerData, setCustomerData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [newNote, setNewNote] = useState('');
    const [isSubmittingNote, setIsSubmittingNote] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);
    const [showNoteModal, setShowNoteModal] = useState(false);
    const [selectedBookingForNote, setSelectedBookingForNote] = useState(null);

    const fetchData = useCallback(async () => {
        if (!user || user.user_metadata?.is_admin) {
             setLoading(false);
             return;
        };

        const customerDbId = user.user_metadata?.customer_db_id;
        if (!customerDbId) {
            toast({ title: "Portal Error", description: "Could not link to customer record.", variant: "destructive" });
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('get-customer-details', {
                body: { customerId: customerDbId }
            });

            if (error) throw new Error(error.message);
            if (data.error) throw new Error(data.error);

            const { data: notesData, error: notesError } = await supabase
                .from('customer_notes')
                .select('*')
                .eq('customer_id', customerDbId)
                .order('created_at', { ascending: false });

            if (notesError) throw notesError;

            setCustomerData({
                ...data.customer,
                bookings: data.bookings || [],
                notes: notesData || [],
            });

        } catch (error) {
            toast({ title: "Error loading portal data", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading) {
            if (user && !user.user_metadata?.is_admin) {
                fetchData();
            } else if (!user) {
                toast({ title: "Access Denied", description: "Please sign in to view your portal.", variant: "destructive" });
                navigate('/login');
            }
        }
    }, [user, authLoading, fetchData, navigate]);
    
    const handleAddNoteClick = (booking) => {
        setSelectedBookingForNote(booking);
        setShowNoteModal(true);
    };

    const handleAddNote = async () => {
        if (!newNote.trim() || !selectedBookingForNote) return;
        setIsSubmittingNote(true);

        const { error } = await supabase.from('customer_notes').insert({
            customer_id: customerData.id,
            booking_id: selectedBookingForNote.id,
            source: 'Customer Portal',
            content: newNote
        });
        if (error) {
            toast({ title: "Error saving note", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Note added successfully!" });
            setNewNote('');
            setShowNoteModal(false);
            fetchData();
        }
        setIsSubmittingNote(false);
    };
    
    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const filePath = `${customerData.id}/licenses/${Date.now()}-${file.name}`;
        
        const { error: uploadError } = await supabase.storage
            .from('customer-uploads')
            .upload(filePath, file);

        if (uploadError) {
            toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
        } else {
            const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            const existingUrls = customerData.license_image_urls || [];
            const newImage = { url: data.publicUrl, path: filePath, name: file.name, uploadedAt: new Date().toISOString() };
            const updatedUrls = [...existingUrls, newImage];

            const { error: dbError } = await supabase.from('customers').update({ license_image_urls: updatedUrls }).eq('id', customerData.id);
            if (dbError) {
                toast({ title: "DB Update Failed", description: dbError.message, variant: "destructive" });
            } else {
                toast({ title: "Photo uploaded!" });
                fetchData();
            }
        }
        setIsUploading(false);
    };

    const handleDownload = async (filePath, filename) => {
        try {
            const { data, error } = await supabase.storage.from('customer-uploads').download(filePath);
            if (error) throw error;
            const blob = data;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (error) {
            toast({ title: "Download Failed", description: error.message, variant: "destructive" });
        }
    };
    
    const calendarEvents = customerData?.bookings.map(booking => {
        const isPast = isSameDay(parseISO(booking.pickup_date), new Date()) || new Date() > parseISO(booking.pickup_date);
        return {
            title: booking.plan.name,
            start: booking.drop_off_date,
            end: format(new Date(booking.pickup_date + 'T00:00:00Z'), 'yyyy-MM-dd'),
            allDay: true,
            backgroundColor: isPast ? '#4b5563' : '#1d4ed8',
            borderColor: isPast ? '#4b5563' : '#1d4ed8'
        };
    }) || [];

    if (loading || authLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    if (!customerData) {
        return <div className="text-center py-20"><p>Could not load customer data. You may need to log in again.</p></div>;
    }

    return (
        <div className="container mx-auto py-12 px-4 relative">
             <BackButton className="absolute top-4 left-4 z-20" />
            <div className="flex flex-wrap justify-between items-center mb-8 gap-4 pt-12 md:pt-0">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white">Welcome, {customerData.name}</h1>
                    <p className="text-blue-200">Customer ID: {customerData.customer_id_text}</p>
                </div>
                <Button onClick={signOut} variant="destructive"><LogOut className="mr-2 h-4 w-4" /> Sign Out</Button>
            </div>
             <Dialog open={showNoteModal} onOpenChange={setShowNoteModal}>
                <DialogContent className="bg-gray-900 text-white border-yellow-400">
                    <DialogHeader>
                        <DialogTitle>Add a Note</DialogTitle>
                        <DialogDescription>
                            Your note will be added to booking #{selectedBookingForNote?.id} for our team to review.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            placeholder="Type your message, question, or special instructions here..."
                            rows={5}
                        />
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                        <Button onClick={handleAddNote} disabled={isSubmittingNote || !newNote.trim()}>
                            {isSubmittingNote ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Send className="h-4 w-4 mr-2" />}
                            Submit Note
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                     <Section title="My Calendar" icon={<Calendar className="mr-3 h-6 w-6" />} className="calendar-container-customer">
                        <FullCalendar
                            plugins={[dayGridPlugin]}
                            initialView="dayGridMonth"
                            events={calendarEvents}
                            height="auto"
                            headerToolbar={{
                                left: 'prev,next',
                                center: 'title',
                                right: 'today'
                            }}
                        />
                    </Section>
                    <Section title="Booking History" icon={<FileText className="mr-3 h-6 w-6" />}>
                        {customerData.bookings?.length > 0 ? (
                            customerData.bookings.map(booking => <BookingCard key={booking.id} booking={booking} customer={customerData} onAddNoteClick={handleAddNoteClick} />)
                        ) : (
                            <p className="text-center text-blue-200 py-4">You have no bookings.</p>
                        )}
                    </Section>
                </div>
                
                <div className="space-y-8">
                     <Section title="My Files" icon={<ImageIcon className="mr-3 h-6 w-6" />}>
                        <p className="text-blue-200 text-sm">These are the files you've uploaded for verification. You can upload new files if requested by our team.</p>
                         <div className="grid grid-cols-2 gap-4">
                            {customerData.license_image_urls && customerData.license_image_urls.length > 0 ? (
                               customerData.license_image_urls.map((img, i) => (
                                    <div key={i} className="relative group aspect-video">
                                         <img  className="rounded-lg object-cover w-full h-full" alt={`Uploaded file ${i+1}`} src={img.url} />
                                         <div className="absolute inset-0 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                            <Button size="sm" onClick={() => handleDownload(img.path, img.name)}><Download className="h-4 w-4 mr-2"/> Download</Button>
                                        </div>
                                    </div>
                                ))
                            ) : <p className="col-span-2 text-center text-blue-200 py-8">No files uploaded.</p>}
                         </div>
                         <div className="border-t border-white/20 pt-4">
                             <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                                 <UploadCloud className="mr-2 h-4 w-4" /> 
                                 {isUploading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Upload New File'}
                             </Button>
                             <Input ref={fileInputRef} type="file" className="hidden" onChange={handlePhotoUpload} disabled={isUploading} accept="image/*"/>
                         </div>
                    </Section>
                    <Section title="Recent Notes" icon={<MessageSquare className="mr-3 h-6 w-6" />}>
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                           {customerData.notes?.length > 0 ? customerData.notes.map(note => (
                                <div key={note.id} className={`p-3 rounded-lg ${note.source === 'Customer Portal' ? 'bg-blue-900/50' : 'bg-gray-700/50'}`}>
                                    <p className="font-bold text-sm text-blue-200">{note.source}</p>
                                    <p className="text-white whitespace-pre-wrap">{note.content}</p>
                                    <p className="text-xs text-gray-400 text-right">{format(parseISO(note.created_at), 'Pp')}</p>
                                </div>
                            )) : <p className="text-center text-blue-200 py-4">No notes found.</p>}
                        </div>
                    </Section>
                </div>
            </div>
        </div>
    );
}
