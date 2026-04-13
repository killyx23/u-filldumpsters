
import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Clock, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export const TimePickerDropdown = ({ selectedTime, onTimeChange, timeSlots = [], isLoading = false, placeholder = "Select time", disabled = false }) => {
  const [open, setOpen] = useState(false);

  const selectedLabel = timeSlots.find(slot => slot.value === selectedTime)?.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className="w-full justify-start bg-white/10 border-white/30 text-white hover:bg-white/20 font-normal"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" />
          ) : (
            <Clock className="mr-2 h-4 w-4 text-white" />
          )}
          {selectedLabel || selectedTime || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0 bg-gray-900 border-gray-700 time-picker-popover z-[9999]" align="center">
        <ScrollArea className="h-64 w-full rounded-md time-picker-scroll">
          {timeSlots.length === 0 && !isLoading ? (
            <div className="p-4 text-center text-sm text-gray-400">
              No times available
            </div>
          ) : (
            <div className="p-1">
              {timeSlots.map((slot) => (
                <div
                  key={slot.value}
                  onClick={() => {
                    onTimeChange(slot.value);
                    setOpen(false);
                  }}
                  className={`cursor-pointer rounded-sm px-3 py-2 text-sm text-white hover:bg-yellow-500 hover:text-black transition-colors ${
                    selectedTime === slot.value ? 'bg-yellow-500 text-black font-bold' : ''
                  }`}
                >
                  {slot.label}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
