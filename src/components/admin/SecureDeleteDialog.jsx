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
 * mode: 'booking' deletes the booking; 'verify' only checks ADMIN_DELETE_PASSWORD then calls onDeleted.
 */
export const SecureDeleteFlow = ({
    open,
    bookingId,
    onClose,
    onDeleted,
    mode = 'booking',
    title = 'Admin Authorization Required',
    description = 'To proceed with deleting this booking, please enter the admin deletion password.',
    confirmDescription,
    successToast,
}) => {
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
    }, [open, bookingId, mode]);

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

    const resolvedConfirmDescription =
        confirmDescription ||
        (mode === 'verify'
            ? 'This action cannot be undone. This will permanently remove this record from our servers.'
            : `This action cannot be undone. This will permanently delete booking #${bookingId} and all of its associated data from our servers.`);

    const handleConfirmDelete = async () => {
        setIsLoading(true);
        setError('');

        const body =
            mode === 'verify'
                ? { password, verifyOnly: true }
                : { bookingId, password };

        const { data, error: functionError } = await supabase.functions.invoke('delete-booking', {
            body,
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
            return;
        }

        if (successToast) {
            toast(successToast);
        } else if (mode === 'booking') {
            toast({
                title: 'Booking Deleted',
                description: `Booking #${bookingId} has been permanently removed.`,
            });
        }

        try {
            await onDeleted?.();
        } catch (err) {
            toast({
                title: 'Deletion Failed',
                description: err?.message || 'Authorized, but the delete action failed.',
                variant: 'destructive',
            });
            handleClose();
            return;
        }

        handleClose();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
            <DialogContent className="bg-gray-900 text-white border-red-500">
                {step === 'password' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{title}</DialogTitle>
                            <DialogDescription>{description}</DialogDescription>
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
                            <DialogDescription>{resolvedConfirmDescription}</DialogDescription>
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
                <Trash2 className="mr-2 h-4 w-4" /> Admin Delete
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

/**
 * Just-Delete-only gate for damage photos (History & Receipts style, without Cancel/Reschedule).
 * After password confirm, calls onConfirmDelete(photo) to remove storage + booking JSON.
 */
export const SecureDamagePhotoDeleteDialog = ({ open, photo, onClose, onConfirmDelete }) => {
    const [step, setStep] = useState('reason');
    const [justDeleteSelected, setJustDeleteSelected] = useState(true);

    useEffect(() => {
        if (open) {
            setStep('reason');
            setJustDeleteSelected(true);
        }
    }, [open, photo?.path, photo?.name]);

    const handleClose = () => {
        setStep('reason');
        setJustDeleteSelected(true);
        onClose?.();
    };

    const handleReasonContinue = () => {
        if (!justDeleteSelected) return;
        setStep('secure');
    };

    const photoLabel = photo?.name || 'this damage photo';

    return (
        <>
            <Dialog open={open && step === 'reason'} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
                <DialogContent className="bg-gray-900 text-white border-yellow-400">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-400">Remove Damage Photo</DialogTitle>
                        <DialogDescription className="text-gray-300">
                            Why is this photo being removed?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-4">
                        <Button
                            variant="outline"
                            className={`w-full justify-start h-auto py-3 ${justDeleteSelected ? 'border-red-700 bg-red-900/20' : 'border-gray-600'}`}
                            onClick={() => setJustDeleteSelected(true)}
                        >
                            <Trash2 className="mr-3 h-5 w-5 text-red-500 flex-shrink-0" />
                            <div className="text-left">
                                <p className="font-semibold text-white">Just Delete</p>
                                <p className="text-xs text-gray-400">Permanently remove all records (password required)</p>
                            </div>
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                        <Button onClick={handleReasonContinue} disabled={!justDeleteSelected}>Continue</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <SecureDeleteFlow
                open={open && step === 'secure'}
                mode="verify"
                title="Admin Authorization Required"
                description="To permanently delete this damage photo, please enter the admin deletion password."
                confirmDescription={`This action cannot be undone. This will permanently delete "${photoLabel}" from storage and remove it from all booking records.`}
                successToast={null}
                onClose={handleClose}
                onDeleted={async () => {
                    await onConfirmDelete?.(photo);
                    toast({
                        title: 'Photo Deleted',
                        description: `"${photoLabel}" has been permanently removed.`,
                    });
                }}
            />
        </>
    );
};
