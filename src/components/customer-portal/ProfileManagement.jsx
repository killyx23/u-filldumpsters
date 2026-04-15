import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { User, Mail, Phone, MapPin, Save, Loader2, Key } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';

export const ProfileManagement = ({ customer, onUpdate }) => {
  const [isSaving, setIsSaving] = useState(false);
  const displayFirstName = customer?.first_name || (customer?.name ? customer.name.split(' ')[0] : '');
  const displayLastName = customer?.last_name || (customer?.name ? customer.name.substring(customer.name.indexOf(' ') + 1) : '');

  const [formData, setFormData] = useState({
      first_name: displayFirstName,
      last_name: displayLastName,
      email: customer?.email || '',
      phone: customer?.phone || '',
      street: customer?.street || '',
      city: customer?.city || '',
      state: customer?.state || '',
      zip: customer?.zip || '',
  });

  const handleInputChange = (e) => {
      const { id, value } = e.target;
      setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleAddressSelect = (addressDetails) => {
      setFormData(prev => ({
          ...prev,
          street: addressDetails.street || prev.street,
          city: addressDetails.city || prev.city,
          state: addressDetails.state || prev.state,
          zip: addressDetails.zip || prev.zip
      }));
  };

  const handleSave = async (e) => {
      e.preventDefault();
      setIsSaving(true);
      
      const computedFullName = `${formData.first_name} ${formData.last_name}`.trim();
      const { error } = await supabase
          .from('customers')
          .update({ 
              ...formData, 
              name: computedFullName,
              unverified_address: false // Reset flag on explicit save
          })
          .eq('id', customer.id);

      if (error) {
          toast({ title: "Update Failed", description: error.message, variant: "destructive" });
      } else {
          toast({ title: "Profile Updated!", description: "Your details have been saved successfully." });
          onUpdate();
      }
      setIsSaving(false);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Profile Management</h2>
        <p className="text-sm text-blue-200">Update your contact information and default delivery address.</p>
      </div>

      <Card className="bg-white/5 border-white/10 text-white">
        <CardHeader>
            <CardTitle className="text-xl text-yellow-400">Personal Information</CardTitle>
            <CardDescription className="text-blue-200">ID: {customer?.customer_id_text}</CardDescription>
        </CardHeader>
        <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="first_name" className="text-gray-300 flex items-center"><User className="w-4 h-4 mr-2"/> First Name</Label>
                        <Input id="first_name" value={formData.first_name} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="last_name" className="text-gray-300">Last Name</Label>
                        <Input id="last_name" value={formData.last_name} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email" className="text-gray-300 flex items-center"><Mail className="w-4 h-4 mr-2"/> Email Address</Label>
                        <Input id="email" type="email" value={formData.email} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="phone" className="text-gray-300 flex items-center"><Phone className="w-4 h-4 mr-2"/> Phone Number</Label>
                        <Input id="phone" type="tel" value={formData.phone} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                    </div>
                </div>

                <div className="pt-6 border-t border-white/10 space-y-4">
                    <h3 className="text-lg font-semibold text-yellow-400 flex items-center">
                        <MapPin className="w-5 h-5 mr-2" /> Default Delivery Address
                    </h3>
                    <div className="space-y-2">
                        <Label className="text-gray-300">Search Address</Label>
                        <GooglePlacesAutocomplete 
                            value={formData.street} 
                            onChange={(val) => handleInputChange({ target: { id: 'street', value: val }})} 
                            onAddressSelect={handleAddressSelect} 
                            placeholder="Start typing your address..." 
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="city" className="text-gray-300">City</Label>
                            <Input id="city" value={formData.city} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="state" className="text-gray-300">State</Label>
                            <Input id="state" value={formData.state} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="zip" className="text-gray-300">ZIP</Label>
                            <Input id="zip" value={formData.zip} onChange={handleInputChange} className="bg-black/30 border-white/20 text-white" required />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 px-8">
                        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save Changes
                    </Button>
                </div>
            </form>
        </CardContent>
      </Card>
    </div>
  );
};