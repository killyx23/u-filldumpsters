import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from '@/components/ui/use-toast';
import { Loader2, LogOut, FileText, Image as ImageIcon, MessageSquare, Send, UploadCloud, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { format, parseISO } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { useNavigate } from 'react-router-dom';

const Section = ({ title, icon, children }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20"
    >
        <h2 className="flex items-center text-2xl font-bold text-yellow-400 mb-4">{icon}{title}</h2>
        <div className="space-y-4">{children}</div>
    </motion.div>
);

const BookingCard = ({ booking, customer }) => {
    const receiptRef = useRef();
    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Receipt-${booking.id}`,
    });

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
            <div className="text-right mt-2">
                <Button size="sm" variant="outline" onClick={handlePrint}>View/Print Receipt</Button>
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
            const { data: customer, error: customerError } = await supabase
                .from('customers')
                .select('*')
                .eq('id', customerDbId)
                .single();

            if (customerError) throw customerError;

            const { data: bookings, error: bookingsError } = await supabase
                .from('bookings')
                .select('*')
                .eq('customer_id', customer.id)
                .order('created_at', { ascending: false });
            if (bookingsError) throw bookingsError;

            const { data: notes, error: notesError } = await supabase
                .from('customer_notes')
                .select('*')
                .eq('customer_id', customer.id)
                .order('created_at', { ascending: false });
            if (notesError) throw notesError;

            setCustomerData({ ...customer, bookings, notes });
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

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        setIsSubmittingNote(true);

        const { error } = await supabase.from('customer_notes').insert({
            customer_id: customerData.id,
            source: 'Customer Portal',
            content: newNote
        });
        if (error) {
            toast({ title: "Error saving note", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Note added successfully!" });
            setNewNote('');
            fetchData(); // Refresh data
        }
        setIsSubmittingNote(false);
    };
    
    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        // Use the database customer ID for the folder path to be consistent
        const filePath = `${customerData.id}/licenses/${Date.now()}-${file.name}`;
        
        const { error: uploadError } = await supabase.storage
            .from('customer-uploads')
            .upload(filePath, file);

        if (uploadError) {
            toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
        } else {
            const { data: { publicUrl } } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            const existingUrls = customerData.license_image_urls || [];
            const newImage = { url: publicUrl, path: filePath, name: file.name, uploadedAt: new Date().toISOString() };
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
            toast({ title: "Download Failed", description: "This may be due to new storage policies. Please contact support if this issue persists.", variant: "destructive" });
        }
    };

    if (loading || authLoading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    if (!customerData) {
        return <div className="text-center py-20"><p>Could not load customer data. You may need to log in again.</p></div>;
    }

    return (
        <div className="container mx-auto py-12 px-4">
            <div className="flex flex-wrap justify-between items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white">Welcome, {customerData.name}</h1>
                    <p className="text-blue-200">Customer ID: {customerData.customer_id_text}</p>
                </div>
                <Button onClick={signOut} variant="destructive"><LogOut className="mr-2 h-4 w-4" /> Sign Out</Button>
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
                <div className="space-y-8">
                    <Section title="My Bookings" icon={<FileText className="mr-3 h-6 w-6" />}>
                        {customerData.bookings?.length > 0 ? (
                            customerData.bookings.map(booking => <BookingCard key={booking.id} booking={booking} customer={customerData} />)
                        ) : (
                            <p className="text-center text-blue-200 py-4">You have no bookings.</p>
                        )}
                    </Section>
                    
                    <Section title="My Notes" icon={<MessageSquare className="mr-3 h-6 w-6" />}>
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                           {customerData.notes?.length > 0 ? customerData.notes.map(note => (
                                <div key={note.id} className={`p-3 rounded-lg ${note.source === 'Customer Portal' ? 'bg-blue-900/50' : 'bg-gray-700/50'}`}>
                                    <p className="font-bold text-sm text-blue-200">{note.source}</p>
                                    <p className="text-white whitespace-pre-wrap">{note.content}</p>
                                    <p className="text-xs text-gray-400 text-right">{format(parseISO(note.created_at), 'Pp')}</p>
                                </div>
                            )) : <p className="text-center text-blue-200 py-4">No notes found.</p>}
                        </div>
                         <div className="border-t border-white/20 pt-4">
                            <Textarea
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                placeholder="Add a new note for our team..."
                            />
                            <Button onClick={handleAddNote} disabled={isSubmittingNote || !newNote.trim()} className="mt-2">
                                {isSubmittingNote ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Send className="h-4 w-4 mr-2" />}
                                Add Note
                            </Button>
                        </div>
                    </Section>
                </div>
                
                <Section title="My Files" icon={<ImageIcon className="mr-3 h-6 w-6" />}>
                    <p className="text-blue-200">These are the files you've uploaded for verification.</p>
                     <div className="grid grid-cols-2 gap-4">
                        {customerData.license_image_urls && customerData.license_image_urls.length > 0 ? (
                           customerData.license_image_urls.map((img, i) => (
                                <div key={i} className="relative group aspect-video">
                                     <img  class="rounded-lg object-cover w-full h-full" alt={`Uploaded file ${i+1}`} src="https://images.unsplash.com/photo-1595872018818-97555653a011" />
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
            </div>
        </div>
    );
}