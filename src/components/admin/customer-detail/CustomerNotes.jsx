import React, { useCallback, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { BookOpen, Clock, Loader2, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const NoteCard = ({ note, onToggleReadStatus }) => {
    const [isToggling, setIsToggling] = useState(false);

    const handleToggle = async () => {
        setIsToggling(true);
        await onToggleReadStatus(note.id, !note.is_read);
        setIsToggling(false);
    };
    
    return (
    <div className={`p-4 rounded-lg relative transition-colors duration-300 ${note.is_read ? 'bg-white/5' : 'bg-yellow-900/30 border border-yellow-500'}`}>
        <div className="flex justify-between items-start mb-2 gap-4">
            <div>
                <p className="font-semibold text-blue-200 flex items-center">
                    <BookOpen className="mr-2 h-4 w-4" />
                    {note.source}
                </p>
                <p className="text-xs text-gray-400 flex items-center mt-1">
                    <Clock className="mr-1 h-3 w-3" />
                    {format(parseISO(note.created_at), 'MMM d, yyyy @ h:mm a')}
                </p>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
                <Label htmlFor={`read-toggle-${note.id}`} className={`text-xs ${note.is_read ? 'text-gray-400' : 'text-yellow-300'}`}>
                    {note.is_read ? 'Read' : 'Unread'}
                </Label>
                <Switch
                    id={`read-toggle-${note.id}`}
                    checked={!note.is_read}
                    onCheckedChange={handleToggle}
                    disabled={isToggling}
                    className="data-[state=checked]:bg-yellow-500 data-[state=unchecked]:bg-gray-600"
                />
            </div>
        </div>
        <p className="text-white whitespace-pre-wrap">{note.content}</p>
        {note.booking_id && <p className="text-xs text-gray-500 mt-2">Related to Booking #{note.booking_id}</p>}
    </div>
)};


export const CustomerNotes = ({ customer, notes, setNotes, onUpdate, loading }) => {
    
    const markAllAsRead = async () => {
        const unreadNoteIds = notes.filter(n => !n.is_read).map(n => n.id);
        if (unreadNoteIds.length === 0) return;

        const { error: updateNotesError } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .in('id', unreadNoteIds);
        
        if (updateNotesError) {
            toast({ title: 'Failed to mark notes as read', description: updateNotesError.message, variant: 'destructive' });
        } else {
            toast({ title: 'All notes marked as read!' });
            onUpdate();
        }
    };
    
    const toggleReadStatus = async (noteId, newReadStatus) => {
        const { error } = await supabase
            .from('customer_notes')
            .update({ is_read: newReadStatus })
            .eq('id', noteId);
            
        if (error) {
            toast({ title: 'Failed to update note status', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `Note marked as ${newReadStatus ? 'read' : 'unread'}` });
            onUpdate();
        }
    };
    
    const hasUnreadNotes = notes.some(n => !n.is_read);

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="flex items-center text-xl font-bold text-yellow-400">Customer Communication Log</h3>
                {hasUnreadNotes && (
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
                        notes.map(note => <NoteCard key={note.id} note={note} onToggleReadStatus={toggleReadStatus} />)
                    ) : (
                        <p className="text-center text-blue-200 py-16">No notes or correspondence history for this customer.</p>
                    )}
                </div>
            )}
        </div>
    );
};