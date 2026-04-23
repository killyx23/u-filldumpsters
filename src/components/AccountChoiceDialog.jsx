import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UserPlus, UserCheck, ShieldAlert } from 'lucide-react';

export const AccountChoiceDialog = ({ open, onOpenChange, onGuest, onAccount, onShowGuestWarning }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-yellow-400 text-center">Create an Account or Continue as Guest?</DialogTitle>
                    <DialogDescription className="text-center text-blue-200 pt-2">
                        Creating an account lets you view your booking history, add notes, and manage your rentals easily.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                     <Button size="lg" className="w-full py-6 text-lg" onClick={onAccount}>
                        <UserPlus className="mr-3 h-6 w-6" /> Create My Account
                    </Button>
                     <Button size="lg" variant="secondary" className="w-full py-6 text-lg bg-blue-600 hover:bg-blue-700" onClick={onShowGuestWarning}>
                        <UserCheck className="mr-3 h-6 w-6" /> Continue as Guest
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const GuestWarningDialog = ({ open, onOpenChange, onConfirm }) => {
     return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-2xl text-red-400">
                        <ShieldAlert className="mr-3 h-8 w-8" />
                        Continue Without an Account?
                    </DialogTitle>
                     <DialogDescription className="text-blue-200 pt-4 text-left">
                        You are proceeding as a guest. Your booking details will be sent to your email, but you won't be able to log in to view your history or manage your booking online.
                        <br/><br/>
                        <strong>Please be sure to save your confirmation email and receipt.</strong>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:justify-end mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Go Back & Create Account</Button>
                    <Button variant="destructive" onClick={onConfirm}>I Understand, Continue as Guest</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};