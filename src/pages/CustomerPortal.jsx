import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
    import { supabase } from '@/lib/customSupabaseClient';
    import { useAuth } from '@/contexts/SupabaseAuthContext';
    import { useNavigate } from 'react-router-dom';
    import { Loader2, LogOut, User, Calendar, Star, MessageSquare, Truck, Edit, Save, X, Send, Paperclip, Home, Mail, Phone, Key, AlertTriangle, Info, CheckCircle, XCircle, Smile, FileText, Upload, Image as ImageIcon, ShieldCheck, DollarSign } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { toast } from '@/components/ui/use-toast';
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card.jsx";
    import { Input } from "@/components/ui/input";
    import { Textarea } from "@/components/ui/textarea";
    import { format, parseISO, isFuture, isToday, isYesterday, addDays, isSameDay, differenceInCalendarDays } from 'date-fns';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { useReactToPrint } from 'react-to-print';
    import { PrintableReceipt } from '@/components/PrintableReceipt';
    import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
    import { Calendar as ShadCalendar } from '@/components/ui/calendar';
    import { Checkbox } from '@/components/ui/checkbox';
    import { Label } from '@/components/ui/label';
    import FullCalendar from '@fullcalendar/react';
    import dayGridPlugin from '@fullcalendar/daygrid';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import { generateTimeSlotOptions } from '@/components/admin/availability/time-helpers';
    import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
    import EmojiPicker from 'emoji-picker-react';
    import { VerificationManager } from '@/components/customer-portal/VerificationManager';

    const RescheduleDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
        const [step, setStep] = useState(1);
        const [isSubmitting, setIsSubmitting] = useState(false);
        const [newDropOffDate, setNewDropOffDate] = useState(null);
        const [newPickupDate, setNewPickupDate] = useState(null);
        const [newDropOffTime, setNewDropOffTime] = useState(booking?.drop_off_time_slot || '');
        const [newPickupTime, setNewPickupTime] = useState(booking?.pickup_time_slot || '');
        const [availableDates, setAvailableDates] = useState([]);
        const [loadingAvailability, setLoadingAvailability] = useState(false);
        const [agreed, setAgreed] = useState(false);
        const [costBreakdown, setCostBreakdown] = useState(null);
        const [agreedToCharges, setAgreedToCharges] = useState(false);

        const timeSlots = useMemo(() => {
            const serviceId = booking?.plan?.id;
            if (!serviceId) return generateTimeSlotOptions(120);
            const intervalMap = { 1: 120, 2: 60, 3: 60, 4: 120 };
            return generateTimeSlotOptions(intervalMap[serviceId] || 120);
        }, [booking]);

        const calculatePrice = useCallback((plan, startDate, endDate) => {
            if (!plan || !startDate || !endDate) return 0;
            const isDelivery = booking.addons?.isDelivery;
            const dailyRate = plan.daily_rate || 100;
            const weeklyRate = plan.weekly_rate || 500;

            let duration = differenceInCalendarDays(endDate, startDate);
            if (duration < 1) duration = 1;

            let total = 0;
            if (plan.id === 2 && !isDelivery) { // Dump Trailer
                const weeks = Math.floor(duration / 7);
                const days = duration % 7;
                total = (weeks * weeklyRate) + (days * dailyRate);
            } else { // Dumpster
                total = plan.base_price || 0;
                if (duration > 7) {
                    const extraDays = duration - 7;
                    total += extraDays * 20;
                }
            }
            return total;
        }, [booking]);

        useEffect(() => {
            if (step === 4 && newDropOffDate && newPickupDate) {
                const newServicePrice = calculatePrice(booking.plan, newDropOffDate, newPickupDate);
                const originalServicePrice = calculatePrice(booking.plan, parseISO(booking.drop_off_date), parseISO(booking.pickup_date));
                
                const priceDifference = newServicePrice - originalServicePrice;
                const rescheduleFee = booking.total_price * 0.10;
                const totalChange = priceDifference + rescheduleFee;
                const newTotalPrice = booking.total_price + totalChange;

                setCostBreakdown({
                    originalServicePrice,
                    newServicePrice,
                    priceDifference,
                    rescheduleFee,
                    totalChange,
                    newTotalPrice,
                });
            }
        }, [step, newDropOffDate, newPickupDate, booking, calculatePrice]);

        const fetchAvailability = useCallback(async () => {
            if (!booking) return;
            setLoadingAvailability(true);
            try {
                const { data, error } = await supabase.functions.invoke('get-availability', {
                    body: { 
                        serviceId: booking.plan.id, 
                        isDelivery: booking.addons.isDelivery,
                        startDate: format(new Date(), 'yyyy-MM-dd'),
                        endDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
                    },
                });
                if (error) throw error;
                if (data.error) throw new Error(data.error);
                
                const unavailableDates = data.availability 
                    ? Object.entries(data.availability)
                        .filter(([, val]) => !val.available)
                        .map(([key]) => new Date(key + 'T00:00:00'))
                    : [];

                setAvailableDates(unavailableDates);
            } catch (error) {
                const errorMessage = error.context?.json ? (await error.context.json()).error : error.message;
                toast({ title: "Failed to load availability", description: errorMessage, variant: "destructive" });
            } finally {
                setLoadingAvailability(false);
            }
        }, [booking]);

        useEffect(() => {
            if (isOpen && step === 2) {
                fetchAvailability();
            }
        }, [isOpen, step, fetchAvailability]);

        const resetAndClose = () => {
            setStep(1);
            setIsSubmitting(false);
            setNewDropOffDate(null);
            setNewPickupDate(null);
            setNewDropOffTime(booking?.drop_off_time_slot || '');
            setNewPickupTime(booking?.pickup_time_slot || '');
            setAgreed(false);
            setCostBreakdown(null);
            setAgreedToCharges(false);
            onOpenChange(false);
        };

        const handleSubmit = async () => {
            if (!costBreakdown) return;
            setIsSubmitting(true);
            try {
                const { error } = await supabase.functions.invoke('reschedule-booking', {
                    body: {
                        bookingId: booking.id,
                        newDropOffDate: format(newDropOffDate, 'yyyy-MM-dd'),
                        newPickupDate: format(newPickupDate, 'yyyy-MM-dd'),
                        newDropOffTime: newDropOffTime,
                        newPickupTime: newPickupTime,
                        priceDifference: costBreakdown.totalChange,
                        rescheduleFee: costBreakdown.rescheduleFee,
                        newTotalPrice: costBreakdown.newTotalPrice,
                    },
                });
                if (error) throw error;
                toast({ title: 'Reschedule Request Submitted!', description: 'Your request has been sent for admin approval.' });
                onUpdate();
                resetAndClose();
            } catch (e) {
                const errorMessage = e.context?.json ? (await e.context.json()).error : e.message;
                toast({ title: 'Rescheduling Failed', description: errorMessage, variant: 'destructive' });
                setIsSubmitting(false);
            }
        };

        const isNextDisabled = () => {
            if (step === 2 && !newDropOffDate) return true;
            if (step === 3 && !newPickupDate) return true;
            return false;
        };

        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-lg">
                    {step === 1 && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Reschedule Booking #{booking?.id}</DialogTitle>
                                <DialogDescription>Please review and agree to the terms before proceeding.</DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4 text-blue-100">
                                <p>You are about to request to reschedule your booking. Please be aware of the following:</p>
                                <ul className="list-disc list-inside space-y-2">
                                    <li>Your original dates will be released upon approval of the new dates.</li>
                                    <li>New dates are subject to current availability.</li>
                                    <li>A <span className="font-bold">10% reschedule fee</span> will be applied to your booking total.</li>
                                    <li>Any difference in rental duration cost will be calculated and charged.</li>
                                    <li>Your request will be sent to an admin for final approval and payment processing.</li>
                                </ul>
                                <div className="flex items-center space-x-2 mt-4 p-3 bg-gray-800 rounded-md">
                                    <Checkbox id="agree-terms" checked={agreed} onCheckedChange={setAgreed} />
                                    <Label htmlFor="agree-terms" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        I understand and agree to the rescheduling terms.
                                    </Label>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
                                <Button onClick={() => setStep(2)} disabled={!agreed}>Continue</Button>
                            </DialogFooter>
                        </>
                    )}
                    {step === 2 && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Select New Drop-off Date & Time</DialogTitle>
                            </DialogHeader>
                            <div className="py-4 flex flex-col md:flex-row gap-4 items-center justify-center">
                                {loadingAvailability ? <Loader2 className="h-8 w-8 animate-spin" /> : (
                                    <ShadCalendar
                                        mode="single"
                                        selected={newDropOffDate}
                                        onSelect={setNewDropOffDate}
                                        disabled={date => date < new Date() || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                        initialFocus
                                    />
                                )}
                                <div className="w-full md:w-48">
                                    <Label>Drop-off Time</Label>
                                    <Select value={newDropOffTime} onValueChange={setNewDropOffTime}>
                                        <SelectTrigger><SelectValue placeholder="Select time" /></SelectTrigger>
                                        <SelectContent>
                                            {timeSlots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                                <Button onClick={() => setStep(3)} disabled={isNextDisabled()}>Next: Select Pickup</Button>
                            </DialogFooter>
                        </>
                    )}
                    {step === 3 && (
                         <>
                            <DialogHeader>
                                <DialogTitle>Select New Pickup Date & Time</DialogTitle>
                            </DialogHeader>
                            <div className="py-4 flex flex-col md:flex-row gap-4 items-center justify-center">
                                {loadingAvailability ? <Loader2 className="h-8 w-8 animate-spin" /> : (
                                    <ShadCalendar
                                        mode="single"
                                        selected={newPickupDate}
                                        onSelect={setNewPickupDate}
                                        disabled={date => isSameDay(date, newDropOffDate) || date < newDropOffDate || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                        initialFocus
                                    />
                                )}
                                 <div className="w-full md:w-48">
                                    <Label>Pickup Time</Label>
                                    <Select value={newPickupTime} onValueChange={setNewPickupTime}>
                                        <SelectTrigger><SelectValue placeholder="Select time" /></SelectTrigger>
                                        <SelectContent>
                                            {timeSlots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                                <Button onClick={() => setStep(4)} disabled={isNextDisabled()}>Next: Review Charges</Button>
                            </DialogFooter>
                        </>
                    )}
                    {step === 4 && costBreakdown && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Confirm New Charges</DialogTitle>
                                <DialogDescription>Please review the cost changes before submitting your request.</DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-3">
                                <div className="p-4 bg-gray-800 rounded-lg space-y-2">
                                    <p><strong>Original Dates:</strong> {format(parseISO(booking.drop_off_date), 'PPP')} - {format(parseISO(booking.pickup_date), 'PPP')}</p>
                                    <p><strong>New Dates:</strong> {format(newDropOffDate, 'PPP')} - {format(newPickupDate, 'PPP')}</p>
                                </div>
                                <div className="p-4 bg-white/5 rounded-lg space-y-2 border border-white/10">
                                    <div className="flex justify-between items-center"><span>Original Booking Total:</span> <span>${booking.total_price.toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center"><span>Rental Duration Change:</span> <span className={costBreakdown.priceDifference >= 0 ? 'text-green-400' : 'text-red-400'}>${costBreakdown.priceDifference.toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center"><span>Reschedule Fee (10%):</span> <span>+ ${costBreakdown.rescheduleFee.toFixed(2)}</span></div>
                                    <div className="flex justify-between items-center text-lg font-bold border-t border-yellow-400 pt-2 mt-2">
                                        <span>Additional Charge:</span>
                                        <span className="text-yellow-400">${costBreakdown.totalChange.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-lg font-bold">
                                        <span>New Grand Total:</span>
                                        <span className="text-yellow-400">${costBreakdown.newTotalPrice.toFixed(2)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2 mt-4 p-3 bg-gray-800 rounded-md">
                                    <Checkbox id="agree-charges" checked={agreedToCharges} onCheckedChange={setAgreedToCharges} />
                                    <Label htmlFor="agree-charges" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        I authorize a charge of ${costBreakdown.totalChange.toFixed(2)} and agree to the new total.
                                    </Label>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                                <Button onClick={handleSubmit} disabled={isSubmitting || !agreedToCharges}>
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Submit for Approval
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        );
    };

    const CancelDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
        const [isSubmitting, setIsSubmitting] = useState(false);

        const handleSubmit = async () => {
            setIsSubmitting(true);
            try {
                const { error } = await supabase.functions.invoke('request-booking-change', {
                    body: { bookingId: booking.id, reason: "Customer requested cancellation via portal." },
                });
                if (error) throw error;
                toast({ title: 'Cancellation Request Submitted', description: 'Your request has been sent for review.' });
                onUpdate();
                onOpenChange(false);
            } catch (e) {
                const errorMessage = e.context?.json ? (await e.context.json()).error : e.message;
                toast({ title: 'Cancellation Failed', description: errorMessage, variant: 'destructive' });
            } finally {
                setIsSubmitting(false);
            }
        };

        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="bg-gray-900 border-yellow-400 text-white">
                    <DialogHeader>
                        <DialogTitle>Confirm Cancellation</DialogTitle>
                        <DialogDescription>Are you sure you want to request to cancel booking #{booking?.id}?</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 text-blue-100">
                        <p>A request will be sent to our team to cancel this booking. Please note that cancellation fees may apply according to our terms of service. Our team will review the request and process any applicable refunds.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>Go Back</Button>
                        <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Yes, Request Cancellation
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    };

    const BookingCard = ({ booking, onReceiptClick, onCancelClick, onRescheduleClick }) => {
        const { plan, drop_off_date, pickup_date, status, total_price, addons, was_verification_skipped, reschedule_history } = booking;
        const isDelivery = addons?.isDelivery;
        const canBeChanged = status === 'Confirmed' || status === 'Rescheduled';

        const getStatusInfo = () => {
            switch (status) {
                case 'pending_verification':
                    return { text: 'Pending Verification', color: 'text-orange-400', icon: <AlertTriangle className="h-4 w-4" /> };
                case 'pending_review':
                    const reason = (reschedule_history && reschedule_history.length > 0) ? 'Reschedule Request' : 'Manual Review';
                    return { text: `Pending: ${reason}`, color: 'text-orange-400', icon: <AlertTriangle className="h-4 w-4" /> };
                case 'Confirmed':
                    return { text: 'Confirmed', color: 'text-yellow-400', icon: <CheckCircle className="h-4 w-4" /> };
                case 'Rescheduled':
                    return { text: 'Rescheduled', color: 'text-blue-400', icon: <CheckCircle className="h-4 w-4" /> };
                case 'Delivered':
                case 'waiting_to_be_returned':
                    return { text: 'Active Rental', color: 'text-cyan-400', icon: <Truck className="h-4 w-4" /> };
                case 'Completed':
                case 'flagged':
                    return { text: 'Completed', color: 'text-green-400', icon: <CheckCircle className="h-4 w-4" /> };
                case 'Cancelled':
                    return { text: 'Cancelled', color: 'text-red-500', icon: <XCircle className="h-4 w-4" /> };
                default:
                    return { text: status, color: 'text-gray-400', icon: <Info className="h-4 w-4" /> };
            }
        };
        const statusInfo = getStatusInfo();

        const serviceName = (plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');
        const serviceType = plan?.id;
        const isPending = status === 'pending_verification' || status === 'pending_review';

        return (
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="text-lg font-bold text-yellow-400">{serviceName}</CardTitle>
                            <CardDescription className="text-blue-200">Booking ID: {booking.id}</CardDescription>
                        </div>
                        <div className={`flex items-center gap-2 text-sm font-semibold ${statusInfo.color}`}>
                            {statusInfo.icon}
                            <span>{statusInfo.text}</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <p><strong>{serviceType === 2 ? (isDelivery ? "Delivery" : "Pickup") : "Drop-off"}:</strong> {isPending ? 'Pending Review' : format(parseISO(drop_off_date), 'PPP')}</p>
                    <p><strong>{serviceType === 2 ? "Return" : "Pickup"}:</strong> {isPending ? 'Pending Review' : format(parseISO(pickup_date), 'PPP')}</p>
                    <p><strong>Total:</strong> ${total_price.toFixed(2)}</p>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onReceiptClick(booking)}>View Receipt</Button>
                    {canBeChanged && (
                        <>
                            <Button variant="destructive" size="sm" onClick={() => onCancelClick(booking)}>Cancel</Button>
                            <Button variant="secondary" size="sm" onClick={() => onRescheduleClick(booking)}>Reschedule</Button>
                        </>
                    )}
                </CardFooter>
            </Card>
        );
    };

    const ReviewItem = ({ booking, onReviewSubmit, customerId }) => {
        const [rating, setRating] = useState(0);
        const [title, setTitle] = useState('');
        const [content, setContent] = useState('');
        const [images, setImages] = useState([]);
        const [isSubmitting, setIsSubmitting] = useState(false);
        const fileInputRef = useRef(null);
        const { plan, addons } = booking;
        const isDelivery = addons?.isDelivery;
        const serviceName = (plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');

        const handleImageUpload = async (files) => {
            const uploadedImageUrls = [];
            for (const file of files) {
                const filePath = `review-images/${customerId}/${booking.id}/${Date.now()}-${file.name}`;
                const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
                if (uploadError) {
                    toast({ title: "Image Upload Failed", description: uploadError.message, variant: "destructive" });
                    return null;
                }
                const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
                uploadedImageUrls.push(data.publicUrl);
            }
            return uploadedImageUrls;
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            if (rating === 0 || !content) {
                toast({ title: "Missing Fields", description: "Please provide a rating and a review.", variant: "destructive" });
                return;
            }
            setIsSubmitting(true);
            try {
                let imageUrls = [];
                if (images.length > 0) {
                    const uploadedUrls = await handleImageUpload(images);
                    if (uploadedUrls) {
                        imageUrls = uploadedUrls;
                    } else {
                        setIsSubmitting(false);
                        return;
                    }
                }

                await onReviewSubmit({
                    booking_id: booking.id,
                    rating,
                    title,
                    content,
                    image_urls: imageUrls,
                });
                toast({ title: "Review Submitted!", description: "Thank you for your feedback." });
            } catch (error) {
                toast({ title: "Submission Failed", description: error.message, variant: "destructive" });
            } finally {
                setIsSubmitting(false);
            }
        };

        const onEmojiClick = (emojiObject, field) => {
            if (field === 'title') {
                setTitle(prev => prev + emojiObject.emoji);
            } else {
                setContent(prev => prev + emojiObject.emoji);
            }
        };

        return (
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-yellow-400">{serviceName}</CardTitle>
                    <CardDescription className="text-blue-200">Booking ID: {booking.id}</CardDescription>
                </CardHeader>
                <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="font-semibold mb-2 block">Rating</label>
                            <div className="flex space-x-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <Star
                                        key={star}
                                        className={`cursor-pointer h-8 w-8 transition-colors ${rating >= star ? 'text-yellow-400 fill-yellow-400' : 'text-gray-500'}`}
                                        onClick={() => setRating(star)}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="relative">
                            <Input placeholder="Review Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="bg-white/10 pr-10" />
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-gray-400 hover:text-white">
                                        <Smile className="h-5 w-5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 border-0 bg-transparent">
                                    <EmojiPicker onEmojiClick={(emoji) => onEmojiClick(emoji, 'title')} theme="dark" />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="relative">
                            <Textarea placeholder="Share your experience..." value={content} onChange={(e) => setContent(e.target.value)} required className="bg-white/10 pr-10" />
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button size="icon" variant="ghost" className="absolute right-1 top-2 h-8 w-8 text-gray-400 hover:text-white">
                                        <Smile className="h-5 w-5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 border-0 bg-transparent">
                                    <EmojiPicker onEmojiClick={(emoji) => onEmojiClick(emoji, 'content')} theme="dark" />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div>
                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                <Upload className="mr-2 h-4 w-4" /> Upload Photos
                            </Button>
                            <input type="file" ref={fileInputRef} multiple accept="image/*" className="hidden" onChange={(e) => setImages(Array.from(e.target.files))} />
                            <div className="mt-2 flex flex-wrap gap-2">
                                {images.map((file, i) => (
                                    <div key={i} className="relative">
                                        <img src={URL.createObjectURL(file)} alt="preview" className="h-16 w-16 rounded object-cover" />
                                        <Button size="icon" variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => setImages(images.filter((_, index) => index !== i))}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Submit Review
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        );
    };

    const ExistingReviewCard = ({ review, booking }) => {
        const { plan, addons } = booking;
        const isDelivery = addons?.isDelivery;
        const serviceName = (plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');

        return (
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-yellow-400">{serviceName}</CardTitle>
                    <CardDescription className="text-blue-200">Reviewed on {format(parseISO(review.created_at), 'PPP')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center mb-2">
                        {[...Array(5)].map((_, i) => (
                            <Star key={i} className={`h-5 w-5 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                        ))}
                    </div>
                    {review.title && <p className="font-bold text-lg mb-2">{review.title}</p>}
                    <p className="text-blue-100 italic">"{review.content}"</p>
                    {review.image_urls && review.image_urls.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {review.image_urls.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                    <img src={url} alt={`Review image ${i + 1}`} className="h-24 w-24 rounded-md object-cover hover:opacity-80 transition-opacity" />
                                </a>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    };

    const MyCalendar = ({ bookings }) => {
        const events = bookings.map(booking => {
            const isDelivery = booking.addons?.isDelivery;
            const serviceName = (booking.plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');
            const serviceType = booking.plan?.id;
            return [
                {
                    title: `${serviceName} - ${serviceType === 2 ? (isDelivery ? "Delivery" : "Pickup") : "Drop-off"}`,
                    start: parseISO(booking.drop_off_date + 'T' + (booking.drop_off_time_slot || '00:00')),
                    allDay: !booking.drop_off_time_slot,
                    backgroundColor: '#f59e0b',
                    borderColor: '#f59e0b'
                },
                {
                    title: `${serviceName} - ${serviceType === 2 ? "Return" : "Pickup"}`,
                    start: parseISO(booking.pickup_date + 'T' + (booking.pickup_time_slot || '23:59')),
                    allDay: !booking.pickup_time_slot,
                    backgroundColor: '#0ea5e9',
                    borderColor: '#0ea5e9'
                }
            ]
        }).flat();

        if (typeof window !== 'undefined') {
            return (
                <div className="bg-white/5 p-4 rounded-lg text-white calendar-container">
                    <FullCalendar
                        plugins={[dayGridPlugin]}
                        initialView="dayGridMonth"
                        events={events}
                        headerToolbar={{
                            left: 'prev,next today',
                            center: 'title',
                            right: 'dayGridMonth'
                        }}
                        height="auto"
                    />
                </div>
            );
        }
        return null;
    };

    const ProfileSection = ({ customer, onUpdate }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [isSaving, setIsSaving] = useState(false);
        const [formData, setFormData] = useState({
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            street: customer.street,
            city: customer.city,
            state: customer.state,
            zip: customer.zip,
        });

        const handleInputChange = (e) => {
            const { id, value } = e.target;
            setFormData(prev => ({ ...prev, [id]: value }));
        };

        const handleSave = async () => {
            setIsSaving(true);
            const { error } = await supabase
                .from('customers')
                .update({ ...formData })
                .eq('id', customer.id);

            if (error) {
                toast({ title: "Update Failed", description: error.message, variant: "destructive" });
            } else {
                toast({ title: "Profile Updated!" });
                onUpdate();
                setIsEditing(false);
            }
            setIsSaving(false);
        };

        const DetailItem = ({ icon, label, value, id }) => (
            <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 h-5 w-5 text-blue-200 mt-1">{icon}</div>
                <div>
                    <p className="text-sm font-semibold text-blue-300">{label}</p>
                    {isEditing && ['name', 'phone', 'street', 'city', 'state', 'zip'].includes(id) ? (
                        <Input id={id} value={value} onChange={handleInputChange} className="bg-white/20 text-base" />
                    ) : (
                        <div className="text-base text-white break-all">{value}</div>
                    )}
                </div>
            </div>
        );

        return (
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-lg font-bold text-yellow-400">Your Information</CardTitle>
                        <CardDescription className="text-blue-200">Manage your contact and address details.</CardDescription>
                    </div>
                    {isEditing ? (
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}><X className="h-4 w-4" /></Button>
                        </div>
                    ) : (
                        <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                    )}
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <DetailItem icon={<User />} label="Name" value={formData.name} id="name" />
                    <DetailItem icon={<Mail />} label="Email" value={formData.email} id="email" />
                    <DetailItem icon={<Phone />} label="Phone" value={formData.phone} id="phone" />
                    <DetailItem icon={<Key />} label="Customer ID" value={customer.customer_id_text} id="customer_id_text" />
                    <DetailItem icon={<Home />} label="Address" value={`${formData.street}, ${formData.city}, ${formData.state} ${formData.zip}`} id="street" />
                </CardContent>
            </Card>
        );
    };

    const Messenger = ({ customer, initialNotes, onNewMessage }) => {
        const [message, setMessage] = useState('');
        const [isSending, setIsSending] = useState(false);
        const chatContainerRef = useRef(null);
        const fileInputRef = useRef(null);

        useEffect(() => {
            if (chatContainerRef.current) {
                chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
        }, [initialNotes]);

        const handleSendMessage = async (attachment = null) => {
            if (!message.trim() && !attachment) return;
            setIsSending(true);

            const tempId = `temp-${Date.now()}`;
            const newNote = {
                id: tempId,
                customer_id: customer.id,
                content: message.trim(),
                source: 'Customer Portal Message',
                author_type: 'customer',
                is_read: false,
                attachment_url: attachment?.url || null,
                attachment_name: attachment?.name || null,
                created_at: new Date().toISOString(),
            };

            onNewMessage(newNote);
            setMessage('');

            const { error } = await supabase.from('customer_notes').insert({
                customer_id: newNote.customer_id,
                content: newNote.content,
                source: newNote.source,
                author_type: newNote.author_type,
                is_read: newNote.is_read,
                attachment_url: newNote.attachment_url,
                attachment_name: newNote.attachment_name,
            });

            if (error) {
                toast({ title: 'Failed to send message', description: error.message, variant: 'destructive' });
                onNewMessage({ ...newNote, error: true });
            }
            setIsSending(false);
        };

        const handleFileUpload = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            setIsSending(true);
            const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;
            
            try {
                const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
                if (uploadError) throw uploadError;

                const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
                
                await handleSendMessage({ url: data.publicUrl, name: file.name });

            } catch (error) {
                toast({ title: "Attachment Failed", description: error.message, variant: "destructive" });
            } finally {
                setIsSending(false);
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            }
        };

        const handleTextareaKeyDown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        };

        const onEmojiClick = (emojiObject) => {
            setMessage(prevMessage => prevMessage + emojiObject.emoji);
        };

        const AttachmentPreview = ({ note }) => {
            if (!note.attachment_url) return null;
            const isImage = /\.(jpg|jpeg|png|gif)$/i.test(note.attachment_name);

            if (isImage) {
                return (
                    <a href={note.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                        <img src={note.attachment_url} alt={note.attachment_name} className="max-w-xs rounded-lg" />
                    </a>
                );
            }

            return (
                <a href={note.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 p-2 bg-black/20 rounded-lg hover:bg-black/40 transition-colors">
                    <FileText className="h-6 w-6 text-yellow-400" />
                    <span className="text-sm font-medium truncate">{note.attachment_name}</span>
                </a>
            );
        };

        const DateSeparator = ({ date }) => {
            const formatDate = (d) => {
                const parsedDate = parseISO(d);
                if (isToday(parsedDate)) return 'Today';
                if (isYesterday(parsedDate)) return 'Yesterday';
                return format(parsedDate, 'MMMM d, yyyy');
            };

            return (
                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t border-gray-600" />
                    </div>
                    <div className="relative flex justify-center">
                        <span className="bg-gray-800 px-2 text-sm text-gray-400">{formatDate(date)}</span>
                    </div>
                </div>
            );
        };

        const ChatBubble = ({ note, isFirstInGroup }) => {
            const isAdmin = note.author_type === 'admin';
            const bubbleClasses = isAdmin
                ? 'bg-gray-700 text-white rounded-bl-none'
                : 'bg-blue-600 text-white rounded-br-none';
            const marginClass = isFirstInGroup ? 'mt-4' : 'mt-1';

            return (
                <div className={`flex items-end gap-2 ${isAdmin ? 'justify-start' : 'justify-end'} ${marginClass}`}>
                    <div className={`p-3 rounded-lg max-w-md ${bubbleClasses}`}>
                        <p className="font-semibold text-sm text-blue-200">{note.source}</p>
                        {note.content && <p className="text-sm whitespace-pre-wrap mt-1">{note.content}</p>}
                        <AttachmentPreview note={note} />
                        <p className="text-xs mt-1 text-right opacity-70">{format(parseISO(note.created_at), 'p')}</p>
                    </div>
                </div>
            );
        };

        const groupedNotes = useMemo(() => {
            if (!initialNotes) return [];
            const groups = [];
            let lastDate = null;
            let lastAuthor = null;

            [...initialNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(note => {
                const noteDate = format(parseISO(note.created_at), 'yyyy-MM-dd');
                if (noteDate !== lastDate) {
                    groups.push({ type: 'date', date: noteDate });
                    lastDate = noteDate;
                    lastAuthor = null;
                }
                
                const isFirstInGroup = note.author_type !== lastAuthor;
                groups.push({ type: 'note', note, isFirstInGroup });
                lastAuthor = note.author_type;
            });
            return groups;
        }, [initialNotes]);

        return (
            <div className="flex flex-col h-[80vh] bg-gray-800 rounded-lg shadow-2xl">
                <header className="p-4 border-b border-gray-700">
                    <h3 className="flex items-center text-lg font-bold text-yellow-400">
                        <MessageSquare className="mr-2 h-5 w-5" />
                        Support Chat
                    </h3>
                </header>

                <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto">
                    {groupedNotes.map((group, index) => {
                        if (group.type === 'date') {
                            return <DateSeparator key={`date-${index}`} date={group.date} />;
                        }
                        return <ChatBubble key={group.note.id} note={group.note} isFirstInGroup={group.isFirstInGroup} />;
                    })}
                </div>

                <footer className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg">
                    <div className="relative">
                        <Textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyDown={handleTextareaKeyDown}
                            placeholder="Type a message..."
                            className="bg-gray-700 border-gray-600 text-white rounded-lg pr-28 resize-none"
                            rows={1}
                            onInput={(e) => {
                                e.target.style.height = 'auto';
                                e.target.style.height = `${e.target.scrollHeight}px`;
                            }}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white">
                                        <Smile className="h-5 w-5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 border-0 bg-transparent">
                                    <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                                </PopoverContent>
                            </Popover>
                            <Button size="icon" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => fileInputRef.current?.click()}>
                                <Paperclip className="h-5 w-5" />
                            </Button>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                            <Button size="icon" onClick={() => handleSendMessage()} disabled={isSending || (!message.trim() && !fileInputRef.current?.files?.length)}>
                                {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                            </Button>
                        </div>
                    </div>
                </footer>
            </div>
        );
    };

    export default function CustomerPortal() {
        const { user, signOut, loading: authLoading, session } = useAuth();
        const navigate = useNavigate();
        const [customerData, setCustomerData] = useState(null);
        const [loading, setLoading] = useState(true);
        const [selectedBookingForReceipt, setSelectedBookingForReceipt] = useState(null);
        const receiptRef = useRef();
        const [notes, setNotes] = useState([]);
        const [hasUnread, setHasUnread] = useState(false);
        const [selectedBookingForCancel, setSelectedBookingForCancel] = useState(null);
        const [selectedBookingForReschedule, setSelectedBookingForReschedule] = useState(null);

        const handlePrint = useReactToPrint({
            content: () => receiptRef.current,
        });

        const fetchData = useCallback(async (isInitialLoad = true) => {
            if (!user || !session) {
                if (isInitialLoad) setLoading(false);
                return;
            }
            if (isInitialLoad) setLoading(true);

            const customerDbId = user.user_metadata?.customer_db_id;
            if (!customerDbId) {
                if (isInitialLoad) setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase.functions.invoke('get-customer-details', {
                    body: { customerId: customerDbId }
                });

                if (error) throw new Error(error.message);
                if (data.error) throw new Error(data.error);

                setCustomerData({
                    ...data.customer,
                    bookings: data.bookings || [],
                });
                setNotes(data.notes || []);
                setHasUnread(data.notes.some(n => !n.is_read && n.author_type === 'admin'));

            } catch (error) {
                toast({ title: "Failed to load data", description: error.message, variant: "destructive" });
            } finally {
                if (isInitialLoad) setLoading(false);
            }
        }, [user, session]);

        useEffect(() => {
            if (!authLoading) {
                if (user && session) {
                    fetchData();
                } else {
                    navigate('/login');
                }
            }
        }, [user, session, authLoading, navigate, fetchData]);

        useEffect(() => {
            if (!customerData) return;

            const channel = supabase.channel(`customer-portal-realtime-${customerData.id}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_notes', filter: `customer_id=eq.${customerData.id}` }, (payload) => {
                    setNotes(currentNotes => {
                        if (currentNotes.some(n => n.id === payload.new.id)) return currentNotes;
                        return [...currentNotes, payload.new];
                    });
                    if (payload.new.author_type === 'admin') {
                        setHasUnread(true);
                    }
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${customerData.id}` }, () => fetchData(false))
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }, [customerData, fetchData]);

        const handleTabChange = (value) => {
            if (value === 'messages') {
                setHasUnread(false);
            }
        };

        const handleSignOut = async () => {
            await signOut();
        };

        const handleReviewSubmit = async (reviewData) => {
            const { data, error } = await supabase
                .from('reviews')
                .insert({ ...reviewData, customer_id: customerData.id, is_public: false })
                .select()
                .single();

            if (error) {
                if (error.code === '23505') { // unique_violation
                    throw new Error("You have already submitted a review for this booking.");
                }
                throw new Error(error.message);
            } else {
                await fetchData(false);
            }
        };

        const handleNewMessage = (newMessage) => {
            setNotes(currentNotes => {
                const existingNoteIndex = currentNotes.findIndex(n => n.id === newMessage.id);
                if (existingNoteIndex !== -1) {
                    const updatedNotes = [...currentNotes];
                    updatedNotes[existingNoteIndex] = newMessage;
                    return updatedNotes;
                }
                return [...currentNotes, newMessage];
            });
        };

        if (loading || authLoading) {
            return <div className="flex justify-center items-center h-screen"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
        }

        if (!customerData) {
            return (
                <div className="text-center py-20">
                    <h2 className="text-2xl font-bold text-red-500">Could not load customer data.</h2>
                    <p className="text-blue-200">Please try logging in again.</p>
                    <Button onClick={() => navigate('/login')} className="mt-4">Go to Login</Button>
                </div>
            );
        }

        const bookings = customerData.bookings || [];
        const toReview = bookings.filter(b => b && (b.status === 'Completed' || b.status === 'flagged') && (!b.reviews || b.reviews.length === 0));
        const existingReviews = bookings.filter(b => b && b.reviews && b.reviews.length > 0).flatMap(b => b.reviews.map(review => ({ ...review, booking: b })));
        const awaitingCompletion = bookings.filter(b => b && isFuture(parseISO(b.pickup_date)) && b.status !== 'Completed' && b.status !== 'Cancelled');

        return (
            <div className="container mx-auto py-16 px-4">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-4xl font-bold text-white">Welcome, {customerData.name}</h1>
                    <Button onClick={handleSignOut} variant="outline"><LogOut className="mr-2 h-4 w-4" /> Sign Out</Button>
                </div>

                <Tabs defaultValue="bookings" className="w-full" onValueChange={handleTabChange}>
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-6 bg-white/10 text-white mb-6">
                        <TabsTrigger value="profile"><User className="mr-2 h-4 w-4" />Profile</TabsTrigger>
                        <TabsTrigger value="verification"><ShieldCheck className="mr-2 h-4 w-4" />Verification</TabsTrigger>
                        <TabsTrigger value="bookings"><Truck className="mr-2 h-4 w-4" />Booking History</TabsTrigger>
                        <TabsTrigger value="reviews"><Star className="mr-2 h-4 w-4" />My Reviews</TabsTrigger>
                        <TabsTrigger value="messages" className="relative">
                            <MessageSquare className="mr-2 h-4 w-4" />Messages
                            {hasUnread && <span className="absolute top-1 right-1 block h-3 w-3 rounded-full bg-red-500 border-2 border-gray-800" />}
                        </TabsTrigger>
                        <TabsTrigger value="calendar"><Calendar className="mr-2 h-4 w-4" />My Calendar</TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        <ProfileSection customer={customerData} onUpdate={() => fetchData(false)} />
                    </TabsContent>

                    <TabsContent value="verification">
                        <VerificationManager customer={customerData} onUpdate={() => fetchData(false)} />
                    </TabsContent>

                    <TabsContent value="bookings">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {bookings.length > 0 ? bookings.map(booking => (
                                <BookingCard 
                                    key={booking.id} 
                                    booking={booking} 
                                    onReceiptClick={setSelectedBookingForReceipt}
                                    onCancelClick={setSelectedBookingForCancel}
                                    onRescheduleClick={setSelectedBookingForReschedule}
                                />
                            )) : <p>You have no bookings yet.</p>}
                        </div>
                    </TabsContent>

                    <TabsContent value="reviews">
                        <div className="space-y-8">
                            <div>
                                <h2 className="text-2xl font-bold mb-4 text-yellow-400">Pending Reviews</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {toReview.length > 0 ? toReview.map(booking => (
                                        <ReviewItem key={booking.id} booking={booking} onReviewSubmit={handleReviewSubmit} customerId={customerData.id} />
                                    )) : <p className="text-blue-200">No services are currently pending a review.</p>}
                                </div>
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold mb-4 text-yellow-400">Awaiting Service Completion</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {awaitingCompletion.length > 0 ? awaitingCompletion.map(booking => (
                                        <Card key={booking.id} className="bg-white/5 border-white/10 text-white">
                                            <CardHeader>
                                                <CardTitle className="text-lg font-bold text-yellow-400">{(booking.plan?.name || 'Service') + (booking.addons?.isDelivery ? ' with Delivery' : '')}</CardTitle>
                                                <div className="flex items-center gap-2">
                                                    <CardDescription className="text-blue-200">Awaiting Completion</CardDescription>
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger>
                                                                <Info className="h-4 w-4 text-blue-300 cursor-help" />
                                                            </TooltipTrigger>
                                                            <TooltipContent className="bg-gray-900 border-yellow-500 text-white">
                                                                <p>Please come back here to make your review after your service has been completed.</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>
                                            </CardHeader>
                                            <CardContent>
                                                <p className="text-sm">Service scheduled for {format(parseISO(booking.drop_off_date), 'PPP')}.</p>
                                            </CardContent>
                                        </Card>
                                    )) : <p className="text-blue-200">No upcoming services found.</p>}
                                </div>
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold mb-4 text-yellow-400">Submitted Reviews</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {existingReviews.length > 0 ? existingReviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(review => (
                                        <ExistingReviewCard key={review.id} review={review} booking={review.booking} />
                                    )) : <p className="text-blue-200">You have not submitted any reviews yet.</p>}
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="messages">
                        <Messenger customer={customerData} initialNotes={notes} onNewMessage={handleNewMessage} />
                    </TabsContent>

                    <TabsContent value="calendar">
                        <MyCalendar bookings={bookings} />
                    </TabsContent>
                </Tabs>

                <Dialog open={!!selectedBookingForReceipt} onOpenChange={() => setSelectedBookingForReceipt(null)}>
                    <DialogContent className="max-w-3xl bg-gray-900 border-yellow-400 text-white">
                        <DialogHeader>
                            <DialogTitle>Receipt for Booking #{selectedBookingForReceipt?.id}</DialogTitle>
                        </DialogHeader>
                        <div className="max-h-[70vh] overflow-y-auto p-2">
                            <PrintableReceipt ref={receiptRef} booking={selectedBookingForReceipt ? { ...selectedBookingForReceipt, customers: customerData } : null} />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setSelectedBookingForReceipt(null)}>Close</Button>
                            <Button onClick={handlePrint}>Print Receipt</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

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
                        booking={selectedBookingForReschedule}
                        isOpen={!!selectedBookingForReschedule}
                        onOpenChange={() => setSelectedBookingForReschedule(null)}
                        onUpdate={() => fetchData(false)}
                    />
                )}
            </div>
        );
    }