import React from 'react';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

export const RadioCard = ({ id, value, label, icon }) => (
    <div>
        <RadioGroupItem value={value} id={id} className="peer sr-only" />
        <Label 
            htmlFor={id} 
            className="flex items-center justify-center rounded-md border-2 border-white/20 bg-transparent p-3 text-white hover:bg-white/10 peer-data-[state=checked]:border-yellow-400 peer-data-[state=checked]:text-yellow-400 [&:has([data-state=checked])]:border-yellow-400 cursor-pointer transition-colors"
        >
            {icon && <span className="mr-2">{icon}</span>}
            {label}
        </Label>
    </div>
);