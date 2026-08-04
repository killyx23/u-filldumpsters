import React, { useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MapPin, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete';
import { toast } from '@/components/ui/use-toast';

function resolveContactAddress(booking) {
  const contact = booking?.contact_address;
  if (contact?.street) {
    return {
      street: contact.street || '',
      city: contact.city || '',
      state: contact.state || '',
      zip: contact.zip || '',
      isVerified: contact.isVerified !== false,
      unverifiedAccepted: Boolean(contact.unverifiedAccepted),
    };
  }
  return {
    street: booking?.street || booking?.customers?.street || '',
    city: booking?.city || booking?.customers?.city || '',
    state: booking?.state || booking?.customers?.state || '',
    zip: booking?.zip || booking?.customers?.zip || '',
    isVerified: true,
    unverifiedAccepted: false,
  };
}

function formatAddressString(address) {
  if (!address) return '';
  return `${address.street}, ${address.city}, ${address.state} ${address.zip}`.trim();
}

export const RescheduleContactAddressSection = ({ booking, onAddressUpdated }) => {
  const originalAddress = resolveContactAddress(booking);
  const originalAddressStr = formatAddressString(originalAddress);

  const [useSameAddress, setUseSameAddress] = useState(true);
  const [newAddress, setNewAddress] = useState({
    street: '',
    city: '',
    state: '',
    zip: '',
    isVerified: false,
    unverifiedAccepted: false,
  });
  const [showManualWarningDialog, setShowManualWarningDialog] = useState(false);
  const [manualAddressAccepted, setManualAddressAccepted] = useState(false);

  const notifyParent = useCallback(
    (address, meta = {}) => {
      onAddressUpdated?.({
        street: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
        formatted_address: formatAddressString(address),
        isVerified: address.isVerified,
        unverifiedAccepted: address.unverifiedAccepted,
        pending_address_verification: meta.pending_address_verification ?? !address.isVerified,
        unverified_address: meta.unverified_address ?? (!address.isVerified ? formatAddressString(address) : null),
        pending_verification_reason: meta.pending_verification_reason ?? (!address.isVerified ? 'Address entered manually' : null),
        isManualEntry: meta.isManualEntry ?? (!address.isVerified && address.unverifiedAccepted),
        error: meta.error ?? false,
      });
    },
    [onAddressUpdated]
  );

  useEffect(() => {
    if (useSameAddress) {
      notifyParent(originalAddress, {
        pending_address_verification: false,
        unverified_address: null,
        pending_verification_reason: null,
        isManualEntry: false,
        error: false,
      });
    }
  }, [useSameAddress, originalAddress, notifyParent]);

  const handleAddressSelect = (details) => {
    const addressData = {
      street: details.street,
      city: details.city,
      state: details.state,
      zip: details.zip,
      isVerified: true,
      unverifiedAccepted: false,
    };
    setNewAddress(addressData);
    setManualAddressAccepted(false);
    notifyParent(addressData, { error: false, isManualEntry: false });
  };

  const handleManualAddressChange = (field, value) => {
    setNewAddress((prev) => {
      const updated = {
        ...prev,
        [field]: value,
        isVerified: false,
        unverifiedAccepted: true,
      };
      if (!updated.street) {
        notifyParent(updated, { error: true });
      }
      return updated;
    });
  };

  const handleContinueWithManualAddress = () => {
    if (!manualAddressAccepted) {
      toast({
        title: 'Acceptance Required',
        description: 'You must accept the risks to continue with manual address entry.',
        variant: 'destructive',
      });
      return;
    }

    const fullAddress = formatAddressString(newAddress);
    notifyParent(
      { ...newAddress, unverifiedAccepted: true },
      {
        error: false,
        isManualEntry: true,
        pending_address_verification: true,
        unverified_address: fullAddress,
        pending_verification_reason: 'Address entered manually',
      }
    );
    setShowManualWarningDialog(false);
    toast({
      title: 'Manual Address Accepted',
      description: 'Your address will be reviewed by our team before your reschedule is finalized.',
      variant: 'default',
    });
  };

  const isManualAddressComplete =
    !useSameAddress &&
    newAddress.street &&
    newAddress.city &&
    newAddress.state &&
    newAddress.zip &&
    !newAddress.isVerified;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto w-full">
      <div className="text-center space-y-3 pb-4">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Contact Address</h2>
        <p className="text-base text-gray-400 max-w-2xl mx-auto">
          Confirm or update the contact address on your booking. This matches the address collected when you first booked your trailer rental.
        </p>
      </div>

      <Card className="bg-gray-900 border-gray-800 shadow-xl rounded-2xl overflow-hidden">
        <CardContent className="p-6 md:p-8 space-y-6">
          <div className="space-y-4">
            <Label className="text-gray-300 text-base font-bold">
              Use the same contact address as your original booking?
            </Label>

            {useSameAddress ? (
              <div className="space-y-4">
                <div className="bg-white/5 p-4 rounded-lg border border-white/10 flex items-start">
                  <MapPin className="h-5 w-5 text-green-400 mr-3 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-white font-medium">{originalAddressStr}</p>
                    <div className="mt-3 bg-green-900/30 border border-green-500/30 p-4 rounded-xl flex items-start gap-4">
                      <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-white text-base mb-1">Address on file</p>
                        <p className="text-sm text-gray-400">Using your original booking contact address.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUseSameAddress(false);
                    notifyParent(newAddress, { error: true });
                  }}
                  className="text-white border-white/30 hover:bg-white/10"
                >
                  Use a different address
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <GooglePlacesAutocomplete
                  value={newAddress.street || ''}
                  onChange={(val) => handleManualAddressChange('street', val)}
                  onAddressSelect={handleAddressSelect}
                  placeholder="Start typing your address..."
                  required
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {['city', 'state', 'zip'].map((field) => (
                    <div key={field} className="relative flex items-center">
                      <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                      <input
                        className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-gold focus:border-gold pl-9 pr-4 py-2 transition-colors capitalize"
                        value={newAddress[field] || ''}
                        onChange={(e) => handleManualAddressChange(field, e.target.value)}
                        placeholder={field === 'zip' ? 'ZIP' : field.charAt(0).toUpperCase() + field.slice(1)}
                      />
                    </div>
                  ))}
                </div>

                {isManualAddressComplete && (
                  <div className="bg-orange-900/30 border border-orange-500/50 p-4 rounded-lg space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
                      <p className="text-orange-200 text-sm">
                        Manual address entry requires verification. Select from the dropdown for automatic verification, or continue with manual entry to flag your address for customer service review.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowManualWarningDialog(true)}
                      className="w-full border-orange-500/50 text-orange-200 hover:bg-orange-500/20"
                    >
                      Continue with Manual Address
                    </Button>
                  </div>
                )}

                {newAddress.isVerified && (
                  <div className="bg-green-900/30 border border-green-500/30 p-5 rounded-xl flex items-start gap-4">
                    <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                    <div>
                      <p className="font-bold text-white text-base mb-1">Address verified</p>
                      <p className="text-sm text-gray-400">{formatAddressString(newAddress)}</p>
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  onClick={() => {
                    setUseSameAddress(true);
                    setNewAddress({ street: '', city: '', state: '', zip: '', isVerified: false, unverifiedAccepted: false });
                    setManualAddressAccepted(false);
                  }}
                  className="text-white border-white/30 hover:bg-white/10 mt-4"
                >
                  Cancel and use original address
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showManualWarningDialog} onOpenChange={setShowManualWarningDialog}>
        <DialogContent className="sm:max-w-md bg-gray-900 border-orange-500/50">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-orange-400 flex items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Manual Address Entry Warning
            </DialogTitle>
            <DialogDescription className="text-gray-300 text-sm leading-relaxed pt-4">
              Manual address entry requires verification. By continuing without Google verification, your reschedule may be delayed while our team confirms your address. Addresses that need verification are flagged for customer service review — the same process as when you first booked.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start space-x-3 py-4">
            <Checkbox
              id="accept-manual-contact-address"
              checked={manualAddressAccepted}
              onCheckedChange={setManualAddressAccepted}
              className="mt-1"
            />
            <label htmlFor="accept-manual-contact-address" className="text-sm text-gray-300 cursor-pointer leading-relaxed">
              I understand and accept the risks
            </label>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowManualWarningDialog(false);
                setManualAddressAccepted(false);
              }}
              className="w-full sm:w-auto border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleContinueWithManualAddress}
              disabled={!manualAddressAccepted}
              className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
            >
              Continue with Manual Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
