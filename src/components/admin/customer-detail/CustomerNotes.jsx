import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const CustomerNotes = ({ customer, setCustomer }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [notes, setNotes] = useState(customer.notes || '');

    const handleSave = async () => {
        const { error } = await supabase
            .from('customers')
            .update({ notes: notes })
            .eq('id', customer.id);
        
        if (error) {
            toast({ title: 'Failed to save notes', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Notes saved successfully!' });
            setIsEditing(false);
            setCustomer(prev => ({ ...prev, notes }));
        }
    };

    return isEditing ? (
        <>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-white/10 min-h-[120px]" placeholder="Add notes about this customer..." />
            <div className="flex justify-end space-x-2 mt-4">
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}><X className="mr-2 h-4 w-4" />Cancel</Button>
                <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700"><Save className="mr-2 h-4 w-4" />Save</Button>
            </div>
        </>
    ) : (
        <>
            <p className="text-blue-200 whitespace-pre-wrap min-h-[120px]">{notes || 'No internal notes for this customer yet.'}</p>
            <div className="text-right mt-4">
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>Edit Notes</Button>
            </div>
        </>
    );
};