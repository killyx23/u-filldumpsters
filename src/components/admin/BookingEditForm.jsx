import React from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, X, Save } from 'lucide-react';
import { EditInput } from '@/components/admin/EditInput';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export const BookingEditForm = ({ editedBooking, onInputChange, onDateChange, onSave, onCancel }) => (
    <div>
        <h3 className="text-2xl font-bold text-yellow-400 mb-4">Editing Booking</h3>
        <div className="space-y-4">
            <EditInput label="Name" name="name" value={editedBooking.name} onChange={onInputChange} />
            <EditInput label="Email" name="email" type="email" value={editedBooking.email} onChange={onInputChange} />
            <EditInput label="Phone" name="phone" type="tel" value={editedBooking.phone} onChange={onInputChange} />
            <EditDateInput label="Drop-off Date" date={new Date(editedBooking.dropOffDate + 'T00:00:00')} onDateChange={(d) => onDateChange(d, 'dropOffDate')} />
            <EditDateInput label="Pickup Date" date={new Date(editedBooking.pickupDate + 'T00:00:00')} onDateChange={(d) => onDateChange(d, 'pickupDate')} />
            <div>
                <Label htmlFor="notes" className="block text-sm font-medium text-blue-200 mb-1">Notes</Label>
                <Textarea id="notes" name="notes" value={editedBooking.notes || ''} onChange={onInputChange} className="bg-white/10 border-white/30" placeholder="Add any internal notes for this booking..." />
            </div>
        </div>
        <div className="mt-6 flex space-x-4">
            <Button onClick={onSave} className="bg-green-500 hover:bg-green-600"><Save className="mr-2 h-4 w-4" /> Save</Button>
            <Button onClick={onCancel} variant="ghost" className="text-white hover:bg-white/10"><X className="mr-2 h-4 w-4" /> Cancel</Button>
        </div>
    </div>
);

const EditDateInput = ({ label, date, onDateChange }) => (<div><label className="block text-sm font-medium text-blue-200 mb-1">{label}</label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white"><CalendarIcon className="mr-2 h-4 w-4"/>{format(date, 'PPP')}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white"><Calendar mode="single" selected={date} onSelect={onDateChange} initialFocus /></PopoverContent></Popover></div>);