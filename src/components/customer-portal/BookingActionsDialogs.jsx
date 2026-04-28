import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { RescheduleDialog as ModularRescheduleDialog } from './reschedule/RescheduleDialog';

// Re-export the modular RescheduleDialog so the rest of the app uses the new one
export const RescheduleDialog = ModularRescheduleDialog;

export const CancelDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('reschedule_history_logs').insert({
                booking_id: booking.id,
                request_type: 'cancellation',
                request_status: 'pending',
                cancellation_reason: "Customer requested cancellation via portal.",
                reschedule_request_time: new Date().toISOString()
            });

            if (error) throw error;
            
            // Also add a note
            await supabase.from('customer_notes').insert({
                customer_id: booking.customer_id,
                booking_id: booking.id,
                source: 'Cancellation Request',
                content: `Customer requested cancellation via portal.`,
                author_type: 'customer'
            });

            // Update status
            await supabase.from('bookings').update({ status: 'cancellation_pending' }).eq('id', booking.id);

            toast({ title: 'Cancellation Request Submitted', description: 'Your request has been sent for review.' });
            if (onUpdate) onUpdate();
            onOpenChange(false);
        } catch (e) {
            toast({ title: 'Cancellation Failed', description: e.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-red-500/50 text-white">
                <DialogHeader>
                    <DialogTitle className="text-red-400">Confirm Cancellation</DialogTitle>
                    <DialogDescription className="text-gray-400">Are you sure you want to request to cancel booking #{booking?.id}?</DialogDescription>
                </DialogHeader>
                <div className="py-4 text-gray-300 text-sm space-y-4">
                    <p>A request will be sent to our team to cancel this booking. Please note that cancellation fees may apply according to our terms of service.</p>
                    <p>Our team will review the request and process any applicable refunds.</p>
                </div>
                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white">Go Back</Button>
                    <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Yes, Request Cancellation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};