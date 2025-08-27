import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, User, Mail, Phone, Home, MapPin, Hash, Save, StickyNote, Key, Edit, X, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditInput } from '@/components/admin/EditInput';
import { Textarea } from '@/components/ui/textarea';

const InfoRow = ({ icon, label, value, href }) => {
    const content = href ? (
        <a href={href} className="text-white hover:text-yellow-400 transition-colors underline break-all">{value}</a>
    ) : (
        <span className="text-white break-all">{value}</span>
    );

    return (
        <div className="flex items-start py-2 border-b border-white/10">
            <div className="flex items-center w-1/3 text-blue-200">
                {React.cloneElement(icon, { className: "mr-3 h-5 w-5" })}
                <span>{label}</span>
            </div>
            <div className="w-2/3">
                {content}
            </div>
        </div>
    );
};


export const CustomerProfile = ({ customer, setCustomer, onUpdate, onHistoryClick }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedCustomer, setEditedCustomer] = useState(customer);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setEditedCustomer(customer);
    }, [customer]);

    const handleInputChange = (field, value) => {
        setEditedCustomer(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        const { admin_notes, ...customerUpdateData } = editedCustomer;
        
        const { data, error } = await supabase
            .from('customers')
            .update(customerUpdateData)
            .eq('id', customer.id)
            .select()
            .single();

        if (error) {
            toast({ title: 'Error saving profile', description: error.message, variant: 'destructive' });
        } else {
            setCustomer(data);
            setIsEditing(false);
            toast({ title: 'Profile updated successfully!' });
            onUpdate();
        }
        setIsSaving(false);
    };

    const handleSaveAdminNotes = async () => {
        setIsSaving(true);
        const { error } = await supabase
            .from('customers')
            .update({ admin_notes: editedCustomer.admin_notes })
            .eq('id', customer.id);
        
        if (error) {
            toast({ title: "Failed to save admin notes", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Admin notes saved!" });
            setCustomer(prev => ({...prev, admin_notes: editedCustomer.admin_notes}));
        }
        setIsSaving(false);
    };

    return (
        <div className="grid md:grid-cols-2 gap-12">
            <div>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="flex items-center text-xl font-bold text-yellow-400">Contact & Billing Information</h3>
                     <div className="flex gap-2">
                        {isEditing ? (
                            <>
                                <Button onClick={handleSave} disabled={isSaving} size="sm">
                                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setEditedCustomer(customer); }}>
                                    <X className="mr-2 h-4 w-4" /> Cancel
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button onClick={onHistoryClick} size="sm" variant="secondary">
                                    <History className="mr-2 h-4 w-4"/> Full History
                                </Button>
                                <Button onClick={() => setIsEditing(true)} size="sm" variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">
                                    <Edit className="mr-2 h-4 w-4"/> Edit Profile
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {isEditing ? (
                    <div className="space-y-4">
                        <EditInput label="Name" icon={<User />} value={editedCustomer.name} onChange={(e) => handleInputChange('name', e.target.value)} isEditing={isEditing} />
                        <EditInput label="Email" icon={<Mail />} value={editedCustomer.email} onChange={(e) => handleInputChange('email', e.target.value)} isEditing={isEditing} type="email" />
                        <EditInput label="Phone" icon={<Phone />} value={editedCustomer.phone} onChange={(e) => handleInputChange('phone', e.target.value)} isEditing={isEditing} type="tel" />
                        <EditInput label="Street" icon={<Home />} value={editedCustomer.street} onChange={(e) => handleInputChange('street', e.target.value)} isEditing={isEditing} />
                        <EditInput label="City" icon={<MapPin />} value={editedCustomer.city} onChange={(e) => handleInputChange('city', e.target.value)} isEditing={isEditing} />
                        <EditInput label="State" icon={<MapPin />} value={editedCustomer.state} onChange={(e) => handleInputChange('state', e.target.value)} isEditing={isEditing} />
                        <EditInput label="ZIP" icon={<MapPin />} value={editedCustomer.zip} onChange={(e) => handleInputChange('zip', e.target.value)} isEditing={isEditing} />
                    </div>
                ) : (
                    <div className="space-y-1">
                        <InfoRow icon={<Key />} label="Customer ID" value={editedCustomer.customer_id_text || 'N/A'} />
                        <InfoRow icon={<User />} label="Name" value={editedCustomer.name} />
                        <InfoRow icon={<Mail />} label="Email" value={editedCustomer.email} href={`mailto:${editedCustomer.email}`} />
                        <InfoRow icon={<Phone />} label="Phone" value={editedCustomer.phone} href={`tel:${editedCustomer.phone}`} />
                        <InfoRow icon={<Home />} label="Address" value={`${editedCustomer.street}, ${editedCustomer.city}, ${editedCustomer.state} ${editedCustomer.zip}`} />
                        <InfoRow icon={<Hash />} label="Stripe ID" value={editedCustomer.stripe_customer_id || "Not Available"} />
                    </div>
                )}
            </div>
            
            <div>
                 <h3 className="flex items-center text-xl font-bold text-yellow-400 mb-4"><StickyNote className="mr-2"/>Admin-Only Notes</h3>
                 <p className="text-sm text-blue-200 mb-2">These notes are private and only visible to administrators.</p>
                 <Textarea 
                    value={editedCustomer.admin_notes || ''}
                    onChange={(e) => handleInputChange('admin_notes', e.target.value)}
                    className="bg-white/10 min-h-[200px]"
                    placeholder="Add private notes here..."
                 />
                 <Button onClick={handleSaveAdminNotes} className="mt-4" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} 
                    Save Notes
                </Button>
            </div>
        </div>
    );
};