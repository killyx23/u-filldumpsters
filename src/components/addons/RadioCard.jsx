import React from 'react';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Check, AlertTriangle } from 'lucide-react';

/**
 * RadioCard Component
 * CRITICAL: This component MUST be used inside a RadioGroup parent component
 * Contains RadioGroupItem which requires RadioGroup context
 */
export const RadioCard = ({ 
  id, 
  value, 
  title, 
  price, 
  description, 
  recommended, 
  warning,
  checked,
  onChange 
}) => (
  <div className="relative">
    <RadioGroupItem value={value} id={id} className="peer sr-only" />
    <Label 
      htmlFor={id} 
      className={`
        flex flex-col rounded-lg border-2 p-4 cursor-pointer transition-all
        ${checked 
          ? 'border-yellow-400 bg-yellow-400/10' 
          : 'border-white/20 bg-white/5 hover:bg-white/10'
        }
        ${warning ? 'hover:border-red-400/50' : ''}
      `}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${checked ? 'text-yellow-400' : 'text-white'}`}>
            {title}
          </span>
          {recommended && (
            <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
              <Check className="h-3 w-3" />
              Recommended
            </span>
          )}
          {warning && (
            <span className="flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
              <AlertTriangle className="h-3 w-3" />
              Warning
            </span>
          )}
        </div>
        <span className={`font-bold ${checked ? 'text-yellow-400' : 'text-white'}`}>
          {price > 0 ? `$${price.toFixed(2)}` : 'Free'}
        </span>
      </div>
      <p className="text-sm text-blue-200">{description}</p>
    </Label>
  </div>
);