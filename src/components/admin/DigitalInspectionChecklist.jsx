
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { ClipboardCheck, Camera, DollarSign, Loader2 } from 'lucide-react';

const INSPECTION_SECTIONS = {
  hydraulics: {
    title: 'HYDRAULICS',
    items: [
      { id: 'fluid_level', label: 'Fluid Level' },
      { id: 'lifting_operation', label: 'Lifting Operation' },
      { id: 'cylinder_piston', label: 'Cylinder/Piston' },
      { id: 'remote_control', label: 'Remote Control' }
    ]
  },
  tires: {
    title: 'TIRES & WHEELS',
    items: [
      { id: 'driver_tires', label: 'Driver Side Tires' },
      { id: 'passenger_tires', label: 'Passenger Side Tires' },
      { id: 'lug_nuts', label: 'Lug Nuts' },
      { id: 'tire_pressure', label: 'Tire Pressure' }
    ]
  },
  electrical: {
    title: 'ELECTRICAL & SAFETY',
    items: [
      { id: 'battery', label: 'Battery' },
      { id: 'breakaway_cable', label: 'Breakaway Cable' },
      { id: 'safety_chains', label: 'Safety Chains' },
      { id: 'lights', label: 'Lights' }
    ]
  },
  body: {
    title: 'BODY & FRAME',
    items: [
      { id: 'fenders', label: 'Fenders' },
      { id: 'sidewalls', label: 'Sidewalls' },
      { id: 'tarp_kit', label: 'Tarp Kit' },
      { id: 'floor', label: 'Floor' },
      { id: 'd_rings', label: 'D-Rings' },
      { id: 'rear_gates', label: 'Rear Gates/Doors' }
    ]
  }
};

export const DigitalInspectionChecklist = ({ booking, inspectionType = 'pickup', onComplete }) => {
  const [inspectionData, setInspectionData] = useState({});
  const [needsCleaning, setNeedsCleaning] = useState(false);
  const [dumpFee, setDumpFee] = useState('');
  const [damageNotes, setDamageNotes] = useState('');
  const [photoFiles, setPhotoFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const handleToggleItem = (sectionKey, itemId, value) => {
    setInspectionData(prev => ({
      ...prev,
      [`${sectionKey}_${itemId}`]: value ? 'pass' : 'fail'
    }));
  };

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files);
    setPhotoFiles(prev => [...prev, ...files]);
  };

  const uploadPhotos = async (orderId) => {
    const photoUrls = [];

    for (const file of photoFiles) {
      try {
        const fileName = `${orderId}_inspection_${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
          .from('verification-documents')
          .upload(fileName, file);

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('verification-documents')
          .getPublicUrl(fileName);

        photoUrls.push(publicUrl);
      } catch (error) {
        console.error('[DigitalInspectionChecklist] Photo upload error:', error);
      }
    }

    return photoUrls;
  };

  const handleCompleteInspection = async () => {
    setSubmitting(true);

    try {
      // Upload photos
      const photoUrls = await uploadPhotos(booking.id);

      // Calculate additional fees
      const cleaningFee = needsCleaning ? 50 : 0; // Default $50 cleaning fee
      const dumpFeeAmount = dumpFee ? parseFloat(dumpFee) : 0;
      const totalAdditionalFees = cleaningFee + dumpFeeAmount;

      // Update booking fees
      const currentFees = booking.fees || {};
      const updatedFees = {
        ...currentFees,
        ...(cleaningFee > 0 && { cleaning_fee: cleaningFee }),
        ...(dumpFeeAmount > 0 && { dump_fee: dumpFeeAmount })
      };

      const newTotalPrice = (booking.total_price || 0) + totalAdditionalFees;

      // Save inspection report
      const inspectionReport = {
        inspection_type: inspectionType,
        inspection_date: new Date().toISOString(),
        trailer_id: 'EB1X095c23a6', // Lock ID
        customer_name: booking.name,
        checklist: inspectionData,
        needs_cleaning: needsCleaning,
        cleaning_fee: cleaningFee,
        dump_fee: dumpFeeAmount,
        damage_notes: damageNotes,
        photo_evidence: photoUrls
      };

      // Update booking
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          fees: updatedFees,
          total_price: newTotalPrice,
          equipment_status: inspectionType,
          return_issues: damageNotes ? { damage_notes: damageNotes, photos: photoUrls } : null
        })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      // Log inspection
      await supabase.from('rental_tracking_logs').insert({
        order_id: booking.id,
        event_type: 'admin_override',
        event_timestamp: new Date().toISOString(),
        notes: `${inspectionType} inspection completed. Additional fees: $${totalAdditionalFees.toFixed(2)}`
      });

      // Send updated receipt via Brevo (if additional fees were added)
      if (totalAdditionalFees > 0) {
        await supabase.functions.invoke('send-booking-confirmation', {
          body: {
            booking_id: booking.id,
            email_type: 'updated_invoice',
            additional_fees: updatedFees
          }
        });
      }

      toast({
        title: 'Inspection Completed',
        description: `Inspection report saved${totalAdditionalFees > 0 ? ` with $${totalAdditionalFees.toFixed(2)} in additional fees` : ''}`
      });

      if (onComplete) onComplete(inspectionReport);

    } catch (error) {
      console.error('[DigitalInspectionChecklist] Submit error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to complete inspection',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-green-400" />
          Digital Inspection Checklist
        </CardTitle>
        <CardDescription className="text-gray-300">
          {inspectionType === 'pickup' ? 'Pre-Rental' : 'Post-Rental'} Equipment Inspection
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Auto-filled Information */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white/5 rounded-lg">
          <div>
            <p className="text-sm text-gray-400">Customer</p>
            <p className="text-white font-semibold">{booking.name}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Trailer ID</p>
            <p className="text-white font-semibold">EB1X095c23a6</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Date/Time</p>
            <p className="text-white font-semibold">{new Date().toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Type</p>
            <p className="text-white font-semibold capitalize">{inspectionType}</p>
          </div>
        </div>

        {/* Inspection Sections */}
        {Object.entries(INSPECTION_SECTIONS).map(([sectionKey, section]) => (
          <div key={sectionKey} className="bg-white/5 p-4 rounded-lg">
            <h3 className="text-lg font-bold text-white mb-4">{section.title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white/5 rounded">
                  <Label htmlFor={`${sectionKey}_${item.id}`} className="text-white">
                    {item.label}
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-400">Fail</span>
                    <Switch
                      id={`${sectionKey}_${item.id}`}
                      checked={inspectionData[`${sectionKey}_${item.id}`] === 'pass'}
                      onCheckedChange={(checked) => handleToggleItem(sectionKey, item.id, checked)}
                    />
                    <span className="text-sm text-green-400">Pass</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Billing Triggers */}
        <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4 space-y-4">
          <h3 className="text-lg font-bold text-white">Billing & Notes</h3>

          <div className="flex items-center justify-between p-3 bg-white/5 rounded">
            <Label htmlFor="needsCleaning" className="text-white">
              Needs Cleaning? (adds $50 fee)
            </Label>
            <Switch
              id="needsCleaning"
              checked={needsCleaning}
              onCheckedChange={setNeedsCleaning}
            />
          </div>

          <div>
            <Label htmlFor="dumpFee" className="text-white mb-2 block">
              Dump Fee (if applicable)
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="dumpFee"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={dumpFee}
                onChange={(e) => setDumpFee(e.target.value)}
                className="pl-9 bg-white/10 border-white/20 text-white"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="damageNotes" className="text-white mb-2 block">
              New Damage Notes
            </Label>
            <Textarea
              id="damageNotes"
              placeholder="Describe any new damage found..."
              value={damageNotes}
              onChange={(e) => setDamageNotes(e.target.value)}
              className="bg-white/10 border-white/20 text-white min-h-[100px]"
            />
          </div>

          <div>
            <Label htmlFor="photoUpload" className="text-white mb-2 block flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Photo Evidence
            </Label>
            <Input
              id="photoUpload"
              type="file"
              multiple
              accept="image/*"
              onChange={handlePhotoUpload}
              className="bg-white/10 border-white/20 text-white"
            />
            {photoFiles.length > 0 && (
              <p className="text-sm text-gray-400 mt-2">
                {photoFiles.length} photo(s) selected
              </p>
            )}
          </div>
        </div>

        {/* Complete Inspection Button */}
        <Button
          onClick={handleCompleteInspection}
          disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-6 text-lg"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Completing Inspection...
            </>
          ) : (
            <>
              <ClipboardCheck className="mr-2 h-5 w-5" />
              Complete Inspection
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
