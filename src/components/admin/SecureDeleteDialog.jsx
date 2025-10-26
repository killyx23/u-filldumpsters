import React, { useState } from 'react';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { Button } from '@/components/ui/button';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
    import { Input } from '@/components/ui/input';
    import { Label } from '@/components/ui/label';
    import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
    
    export const SecureDeleteDialog = ({ bookingId, onDeleted }) => {
        const [isDialogOpen, setIsDialogOpen] = useState(false);
        const [isPasswordPromptOpen, setIsPasswordPromptOpen] = useState(false);
        const [isConfirmOpen, setIsConfirmOpen] = useState(false);
        const [password, setPassword] = useState('');
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState('');
    
        const handleInitialDeleteClick = () => {
            setIsDialogOpen(true);
            setIsPasswordPromptOpen(true);
            setIsConfirmOpen(false);
            setPassword('');
            setError('');
        };
    
        const handlePasswordSubmit = async () => {
            setIsLoading(true);
            setError('');
    
            // Just a client-side check to see if password is entered
            if (!password) {
                setError('Password is required.');
                setIsLoading(false);
                return;
            }
    
            // We don't validate password here. We just move to confirm step.
            // The password will be validated in the backend.
            setIsPasswordPromptOpen(false);
            setIsConfirmOpen(true);
            setIsLoading(false);
        };
    
        const handleConfirmDelete = async () => {
            setIsLoading(true);
            setError('');
    
            const { error: functionError } = await supabase.functions.invoke('delete-booking', {
                body: { bookingId, password },
            });
    
            setIsLoading(false);
    
            if (functionError) {
                const message = functionError.context?.error?.error || functionError.message;
                toast({ title: 'Deletion Failed', description: message, variant: 'destructive' });
                // If password was wrong, go back to password prompt
                if (message === 'Invalid password.') {
                    setIsConfirmOpen(false);
                    setIsPasswordPromptOpen(true);
                    setError('Incorrect password. Please try again.');
                } else {
                    handleClose();
                }
            } else {
                toast({ title: 'Booking Deleted', description: `Booking #${bookingId} has been permanently removed.` });
                onDeleted();
                handleClose();
            }
        };
    
        const handleClose = () => {
            setIsDialogOpen(false);
            setIsPasswordPromptOpen(false);
            setIsConfirmOpen(false);
            setPassword('');
            setError('');
        };
    
        return (
            <>
                <Button size="sm" variant="destructive" onClick={handleInitialDeleteClick}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
    
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="bg-gray-900 text-white border-red-500">
                        {isPasswordPromptOpen && (
                            <>
                                <DialogHeader>
                                    <DialogTitle>Admin Authorization Required</DialogTitle>
                                    <DialogDescription>
                                        To proceed with deleting this booking, please enter the admin deletion password.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="py-4">
                                    <Label htmlFor="password">Deletion Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="bg-white/20"
                                        autoFocus
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
    
                        {isConfirmOpen && (
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
                                    <Button variant="ghost" onClick={() => { setIsConfirmOpen(false); setIsPasswordPromptOpen(true); }}>Back</Button>
                                    <Button variant="destructive" onClick={handleConfirmDelete} disabled={isLoading}>
                                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                        Yes, permanently delete
                                    </Button>
                                </DialogFooter>
                            </>
                        )}
                    </DialogContent>
                </Dialog>
            </>
        );
    };