import React, { useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { BookOpen, Clock, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';

const NoteCard = ({ note }) => (
    <div className="bg-white/10 p-4 rounded-lg relative">
        {!note.is_read && <span className="absolute top-2 right-2 h-3 w-3 rounded-full bg-yellow-400"></span>}
        <div className="flex justify-between items-center mb-2">
            <p className="font-semibold text-blue-200 flex items-center">
                <BookOpen className="mr-2 h-4 w-4" />
                {note.source}
            </p>
            <p className="text-xs text-gray-400 flex items-center">
                <Clock className="mr-1 h-3 w-3" />
                {format(parseISO(note.created_at), 'MMM d, yyyy @ h:mm a')}
            </p>
        </div>
        <p className="text-white whitespace-pre-wrap">{note.content}</p>
        {note.booking_id && <p className="text-xs text-gray-500 mt-2">Related to Booking #{note.booking_id}</p>}
    </div>
);


export const CustomerNotes = ({ customer, notes, setCustomer, setNotes, loading }) => {
    
    const markAllAsRead = async () => {
        const unreadNoteIds = notes.filter(n => !n.is_read).map(n => n.id);
        if (unreadNoteIds.length === 0) return;

        const { error: updateNotesError } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .in('id', unreadNoteIds);

        const { error: updateCustomerError } = await supabase
            .from('customers')
            .update({ has_unread_notes: false })
            .eq('id', customer.id);
        
        if (updateNotesError || updateCustomerError) {
            toast({ title: 'Failed to mark notes as read', variant: 'destructive' });
        } else {
            toast({ title: 'Notes marked as read!' });
            setNotes(prev => prev.map(n => ({...n, is_read: true})));
            setCustomer(prev => ({...prev, has_unread_notes: false}));
        }
    };
    
    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="flex items-center text-xl font-bold text-yellow-400">Customer Communication Log</h3>
                {customer.has_unread_notes && (
                    <Button size="sm" onClick={markAllAsRead} variant="outline" className="text-yellow-400 border-yellow-400 hover:bg-yellow-400 hover:text-black">
                       <CheckCircle className="mr-2 h-4 w-4"/> Mark All as Read
                    </Button>
                )}
            </div>
            {loading ? (
                <div className="flex justify-center items-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                </div>
            ) : (
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {notes.length > 0 ? (
                        notes.map(note => <NoteCard key={note.id} note={note} />)
                    ) : (
                        <p className="text-center text-blue-200 py-16">No notes or correspondence history for this customer.</p>
                    )}
                </div>
            )}
        </div>
    );
};