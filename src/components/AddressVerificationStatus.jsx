
import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, Info, ShieldAlert, FileText } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export const AddressVerificationStatus = ({ 
  status, // 'verified', 'unverified', 'failed'
  message,
  onAcknowledge,
  acknowledged,
  termsAccepted,
  onTermsAcceptChange,
  onVerificationSuccess // Task 4: Callback for successful verification
}) => {

  // Task 4: Communicate verification result back to parent
  useEffect(() => {
    if (status === 'verified' && onVerificationSuccess) {
      onVerificationSuccess();
    }
  }, [status, onVerificationSuccess]);

  return (
    <div className="space-y-4">
      {/* Verified Status */}
      {status === 'verified' && (
        <div className="bg-green-900/30 border border-green-500/50 p-3 rounded-lg flex items-center text-green-300 text-sm">
          <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" />
          Address verified successfully via Google Maps
        </div>
      )}

      {/* Unverified / Manual / Warning Status */}
      {(status === 'failed' || status === 'unverified') && (
        <div className="bg-amber-900/30 border border-amber-500/50 p-4 rounded-lg">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-amber-400 mr-3 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-amber-300 mb-1">
                {status === 'failed' ? "Address Verification Notice" : "Manual Address Entry"}
              </p>
              <p className="text-sm text-amber-200 mb-4">
                {message || "⚠️ Address could not be verified automatically. Please review and confirm your address is correct. Incorrect addresses may cause delivery delays or cancellation."}
              </p>
              
              <div className="flex items-start space-x-3 bg-black/30 p-3 rounded-md border border-amber-500/20">
                <Checkbox 
                  id="acknowledge-verification" 
                  checked={acknowledged} 
                  onCheckedChange={onAcknowledge}
                  className="mt-0.5 border-amber-400 data-[state=checked]:bg-amber-500"
                />
                <label htmlFor="acknowledge-verification" className={`text-sm cursor-pointer transition-colors ${acknowledged ? 'text-green-400 font-semibold' : 'text-amber-100'}`}>
                  I confirm this address is correct and I wish to proceed.
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terms and Conditions Block */}
      <div className="bg-gray-900/60 border border-gray-700 p-5 rounded-lg space-y-4">
        <div className="flex items-center text-yellow-400 font-bold mb-2">
          <FileText className="h-5 w-5 mr-2" />
          Terms & Conditions Acknowledgement
        </div>
        
        <div className="space-y-3 text-sm text-gray-300">
          <div className="flex items-start">
            <AlertTriangle className="h-4 w-4 text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
            <p><strong className="text-white">Address Mismatch:</strong> If the delivery address doesn't match the verified address on file or cannot be located, we reserve the right to cancel the booking and issue a refund.</p>
          </div>
          <div className="flex items-start">
            <Info className="h-4 w-4 text-blue-400 mr-2 mt-0.5 flex-shrink-0" />
            <p><strong className="text-white">Communication:</strong> A confirmation email will be sent to the provided email address. Please verify your details to complete the booking.</p>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-gray-700">
          <div className="flex items-start space-x-3">
            <Checkbox 
              id="terms-acceptance" 
              checked={termsAccepted} 
              onCheckedChange={onTermsAcceptChange}
              className="mt-1 border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
            />
            <label 
              htmlFor="terms-acceptance" 
              className={`text-sm font-medium cursor-pointer transition-colors ${termsAccepted ? 'text-green-400' : 'text-white'}`}
            >
              I understand and accept all terms and conditions for this rental service. <span className="text-red-400">*</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
