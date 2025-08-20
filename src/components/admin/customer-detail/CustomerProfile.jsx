import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Mail, Phone, Home, Save, X, Calendar, Clock, Route, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, parseISO } from 'date-fns';
import { CustomerProfileHeader } from './CustomerProfileHeader';

export const CustomerProfile = ({ customer, setCustomer, bookingsCount }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editableCustomer, setEditableCustomer] = useState(customer);
    const [eta, setEta] = useState(null);
    const [distance, setDistance] = useState(null);
    const [loadingEta, setLoadingEta] = useState(false);

    const fetchEta = useCallback(async (destination) => {
        if (!destination) return;
        setLoadingEta(true);
        try {
            const { data, error } = await supabase.functions.invoke('get-eta', { body: { destination } });
            if (error) throw error;
            setEta(data.eta);
            setDistance(data.distance);
        } catch (error) {
            console.error("ETA Error:", error.message);
            setEta("Unavailable");
            setDistance("N/A");
        } finally {
            setLoadingEta(false);
        }
    }, []);

    useEffect(() => {
        if (customer && customer.street) {
            const destination = `${customer.street}, ${customer.city}, ${customer.state} ${customer.zip}`;
            fetchEta(destination);
        }
    }, [customer, fetchEta]);
    
    useEffect(() => {
        setEditableCustomer(customer);
    }, [customer]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setEditableCustomer(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        const { name, email, phone, street, city, state, zip } = editableCustomer;
        const { error } = await supabase
            .from('customers')
            .update({ name, email, phone, street, city, state, zip })
            .eq('id', customer.id);

        if (error) {
            toast({ title: 'Failed to save customer info', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Customer info saved successfully!' });
            setIsEditing(false);
            setCustomer(editableCustomer);
        }
    };

    return !isEditing ? (
        <>
            <CustomerProfileHeader customer={customer} bookingsCount={bookingsCount} />
            <div className="mt-4 space-y-2 text-blue-200">
               <p className="flex items-center"><Mail className="mr-3 h-4 w-4" /> {customer.email}</p>
               <p className="flex items-center"><Phone className="mr-3 h-4 w-4" /> {customer.phone}</p>
               <p className="flex items-start"><Home className="mr-3 h-4 w-4 mt-1 flex-shrink-0" /> <span>{`${customer.street}, ${customer.city}, ${customer.state} ${customer.zip}`}</span></p>
               <p className="flex items-center"><Clock className="mr-3 h-4 w-4" /> ETA: {loadingEta ? <Loader2 className="h-4 w-4 animate-spin" /> : eta}</p>
               <p className="flex items-center"><Route className="mr-3 h-4 w-4" /> Distance: {loadingEta ? <Loader2 className="h-4 w-4 animate-spin" /> : distance} (one way)</p>
               <p className="flex items-center"><Calendar className="mr-3 h-4 w-4" /> Member since {format(parseISO(customer.created_at), 'PPP')}</p>
               <p className="flex items-start"><Hash className="mr-3 h-4 w-4 mt-1 flex-shrink-0" /> <span className="break-all">Stripe ID: {customer.stripe_customer_id || 'N/A'}</span></p>
            </div>
            <div className="text-right mt-4">
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>Edit Profile</Button>
            </div>
        </>
    ) : (
        <div className="space-y-4">
            <Input name="name" value={editableCustomer.name} onChange={handleInputChange} placeholder="Full Name" className="bg-white/10" />
            <Input name="email" value={editableCustomer.email} onChange={handleInputChange} placeholder="Email" className="bg-white/10" />
            <Input name="phone" value={editableCustomer.phone} onChange={handleInputChange} placeholder="Phone" className="bg-white/10" />
            <Input name="street" value={editableCustomer.street} onChange={handleInputChange} placeholder="Street" className="bg-white/10" />
            <Input name="city" value={editableCustomer.city} onChange={handleInputChange} placeholder="City" className="bg-white/10" />
            <div className="grid grid-cols-2 gap-2">
                <Input name="state" value={editableCustomer.state} onChange={handleInputChange} placeholder="State" className="bg-white/10" />
                <Input name="zip" value={editableCustomer.zip} onChange={handleInputChange} placeholder="Zip" className="bg-white/10" />
            </div>
            <div className="flex justify-end space-x-2 mt-4">
                <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setEditableCustomer(customer); }}><X className="mr-2 h-4 w-4" />Cancel</Button>
                <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700"><Save className="mr-2 h-4 w-4" />Save</Button>
            </div>
        </div>
    );
};