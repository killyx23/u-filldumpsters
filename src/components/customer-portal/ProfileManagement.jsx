
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { User, Mail, Phone, MapPin, Save, Loader2, Key, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { SmsOptInFields } from '@/components/SmsOptInFields';
import {
  clearProfileDraft,
  consumeSmsReturnPending,
  currentReturnPath,
  readProfileDraft,
  writeProfileDraft,
} from '@/utils/smsFormReturn';
import { addressesAreEqual, formatAddressDisplay } from '@/utils/addressHelpers';

export const ProfileManagement = ({ customer, onUpdate, onNavigateToTab }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [draftReady, setDraftReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const displayFirstName = customer?.first_name || (customer?.name ? customer.name.split(' ')[0] : '');
  const displayLastName = customer?.last_name || (customer?.name ? customer.name.substring(customer.name.indexOf(' ') + 1) : '');

  const [formData, setFormData] = useState({
      first_name: displayFirstName,
      last_name: displayLastName,
      email: customer?.email || '',
      phone: customer?.phone || '',
      sms_opt_in: customer?.sms_opt_in === true,
      sms_marketing_opt_in: customer?.sms_marketing_opt_in === true,
      street: customer?.street || '',
      city: customer?.city || '',
      state: customer?.state || '',
      zip: customer?.zip || '',
  });

  useLayoutEffect(() => {
      if (!customer?.id || draftReady) return;
      const shouldRestore = location.state?.resumeDraft === true || consumeSmsReturnPending(currentReturnPath(location));
      if (shouldRestore) {
          const draft = readProfileDraft(customer.id);
          if (draft?.formData) {
              setFormData(draft.formData);
              setPoliciesAccepted(draft.policiesAccepted === true);
          }
          if (location.state?.resumeDraft) {
              navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
          }
      }
      setDraftReady(true);
  }, [customer?.id, draftReady, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
      if (!draftReady || !customer?.id) return;
      writeProfileDraft(customer.id, { policiesAccepted, formData });
  }, [customer?.id, draftReady, formData, policiesAccepted]);

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
      if (!customer?.id) return;

      if (!policiesAccepted) {
          toast({
              title: "Agreement required",
              description: "Please agree to the Terms and Conditions and Privacy Policy.",
              variant: "destructive",
          });
          return;
      }
      
      setIsSaving(true);

      const currentAddress = {
          street: customer.street || '',
          city: customer.city || '',
          state: customer.state || '',
          zip: customer.zip || '',
      };
      const nextAddress = {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
      };
      const addressChanged = !addressesAreEqual(currentAddress, nextAddress);

      const { data, error } = await supabase.functions.invoke('request-profile-address-change', {
          body: {
              first_name: formData.first_name,
              last_name: formData.last_name,
              email: formData.email,
              phone: formData.phone,
              sms_opt_in: formData.sms_opt_in,
              sms_marketing_opt_in: formData.sms_marketing_opt_in,
              street: formData.street,
              city: formData.city,
              state: formData.state,
              zip: formData.zip,
          },
      });

      if (error || data?.error) {
          let description = data?.error || error?.message || 'Could not save your profile.';
          try {
              const body = await error?.context?.json?.();
              if (body?.error) description = body.error;
          } catch {
              /* use the message already captured */
          }
          toast({ title: "Update Failed", description, variant: "destructive" });
      } else if (addressChanged || data?.addressPending) {
          toast({
              title: "Address submitted for review",
              description: "Your other details were saved. The new address stays pending until customer service approves it. We emailed you that it is under review.",
          });
          clearProfileDraft();
          onUpdate();
      } else {
          toast({ title: "Profile Updated!", description: "Your details have been saved successfully." });
          clearProfileDraft();
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

      <div className="bg-orange-900/30 border border-orange-500/50 rounded-xl p-4 shadow-lg shadow-orange-900/20">
        <h3 className="text-orange-400 font-bold flex items-center mb-2">
          <AlertTriangle className="mr-2 h-5 w-5" /> Important
        </h3>
        <p className="text-orange-200 text-sm leading-relaxed">
          Name, email, phone, and text-message choices save right away. An address change is sent to customer service for approval and does not replace the address on file until it is approved. You will get an email that it is under review, and another email when it is approved or denied. Open orders keep their current address until that approval.
        </p>
        {customer?.pending_address && (
          <p className="text-orange-100 text-sm mt-3">
            Waiting for approval: {formatAddressDisplay(customer.pending_address)}
          </p>
        )}
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
                <SmsOptInFields
                    transactional={formData.sms_opt_in}
                    marketing={formData.sms_marketing_opt_in}
                    onTransactionalChange={(checked) => setFormData(prev => ({ ...prev, sms_opt_in: checked }))}
                    onMarketingChange={(checked) => setFormData(prev => ({ ...prev, sms_marketing_opt_in: checked }))}
                    policiesAccepted={policiesAccepted}
                    onPoliciesAcceptedChange={setPoliciesAccepted}
                />

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
