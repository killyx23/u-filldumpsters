import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';

/**
 * Controlled password + confirm delete flow. Used standalone and from BookingRemovalDialog.
 */
export const SecureDeleteFlow = ({ open, bookingId, onClose, onDeleted }) => {
    const [step, setStep] = useState('password');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setStep('password');
            setPassword('');
            setError('');
        }
    }, [open, bookingId]);

    const handleClose = () => {
        setStep('password');
        setPassword('');
        setError('');
        onClose?.();
    };

    const handlePasswordSubmit = () => {
        if (!password) {
            setError('Password is required.');
            return;
        }
        setError('');
        setStep('confirm');
    };

    const handleConfirmDelete = async () => {
        setIsLoading(true);
        setError('');

        const { data, error: functionError } = await supabase.functions.invoke('delete-booking', {
            body: { bookingId, password },
        });

        setIsLoading(false);

        if (functionError || data?.error) {
            const message = await parseEdgeFunctionError(functionError, data);
            toast({ title: 'Deletion Failed', description: message, variant: 'destructive' });
            if (/invalid password|confirmation password/i.test(message)) {
                setStep('password');
                setError(message);
            } else {
                handleClose();
            }
        } else {
            toast({ title: 'Booking Deleted', description: `Booking #${bookingId} has been permanently removed.` });
            onDeleted?.();
            handleClose();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
            <DialogContent className="bg-gray-900 text-white border-red-500">
                {step === 'password' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Admin Authorization Required</DialogTitle>
                            <DialogDescription>
                                To proceed with deleting this booking, please enter the admin deletion password.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor="secure-delete-password">Deletion Password</Label>
                            <Input
                                id="secure-delete-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="bg-white/20"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                            />
                            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                            <Button onClick={handlePasswordSubmit} disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Continue
                            </Button>
                        </DialogFooter>
                    </>
                )}

                {step === 'confirm' && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center text-red-400">
                                <AlertTriangle className="mr-2 h-6 w-6" /> Are you absolutely sure?
                            </DialogTitle>
                            <DialogDescription>
                                This action cannot be undone. This will permanently delete booking #{bookingId} and all of its associated data from our servers.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep('password')}>Back</Button>
                            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Yes, permanently delete
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export const SecureDeleteDialog = ({ bookingId, onDeleted }) => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
            <SecureDeleteFlow
                open={open}
                bookingId={bookingId}
                onClose={() => setOpen(false)}
                onDeleted={onDeleted}
            />
        </>
    );
};
