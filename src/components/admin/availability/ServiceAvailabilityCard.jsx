import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, ChevronDown, ChevronUp, Save, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeWindowOptions } from './time-helpers';
import { useToast } from '@/components/ui/use-toast';

const TimeWindowSelector = ({ value, onChange, options, placeholder = "Select time window" }) => (
    <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="bg-white/20">
            <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
            {options.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
        </SelectContent>
    </Select>
);

const DayAvailability = ({ dayName, dayIndex, service, initialDayData, onSaveChanges }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [dayData, setDayData] = useState(initialDayData);
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        setDayData(initialDayData);
    }, [initialDayData]);

    const handleSwitchChange = (checked) => {
        const updatedData = { ...dayData, is_available: checked };
        setDayData(updatedData);
        // Immediately save switch changes, as it's a primary action
        handleSave(updatedData);
    };

    const handleTimeWindowChange = (value) => {
        if (!value) {
            setDayData(prev => ({ ...prev, window_start_time: null, window_end_time: null }));
            return;
        }
        const [start, end] = value.split('-');
        setDayData(prev => ({ ...prev, window_start_time: `${start}:00`, window_end_time: `${end}:00` }));
    };

    const handleSave = async (dataToSave) => {
        setIsSaving(true);
        const finalData = dataToSave || dayData;

        const isValid = finalData.is_available ? (
            service.service_type === 'fullday' ? true : (finalData.window_start_time && finalData.window_end_time)
        ) : true;
        
        if (!isValid) {
            toast({
                title: "Incomplete Time Information",
                description: "Please select an operating window before saving.",
                variant: "destructive",
            });
            setIsSaving(false);
            return;
        }
        
        await onSaveChanges(finalData);
        setIsSaving(false);
    };

    const renderTimeInputs = () => {
        if (!dayData.is_available) return null;

        if (service.service_type === 'window') {
            const timeValue = dayData.window_start_time && dayData.window_end_time ? `${dayData.window_start_time.substring(0,5)}-${dayData.window_end_time.substring(0,5)}` : '';
            return (
                <div>
                    <p className="font-semibold text-blue-200 mb-1">Operating Window</p>
                    <TimeWindowSelector
                        options={timeWindowOptions}
                        value={timeValue}
                        onChange={handleTimeWindowChange}
                        placeholder="Select operating window"
                    />
                    <p className="text-xs text-gray-400 mt-1">Both drop-off and pickup slots are generated within this window.</p>
                </div>
            );
        }
        
        if (service.service_type === 'fullday') {
            return (
                <div className="bg-blue-900/20 p-3 rounded-md border border-blue-500">
                    <AlertCircle className="inline-block mr-2 h-4 w-4 text-blue-300" />
                    <span className="text-sm text-blue-200 align-middle">
                        This service is full-day only (8 AM - 10 PM). Availability is controlled by the open/closed switch.
                    </span>
                </div>
            );
        }
        
        return null;
    };

    return (
        <div className="bg-white/10 p-3 rounded-md transition-all duration-300">
            <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>{dayName}</Label>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Switch
                            id={`available-${service.id}-${dayIndex}`}
                            checked={!!dayData.is_available}
                            onCheckedChange={handleSwitchChange}
                        />
                        <Label htmlFor={`available-${service.id}-${dayIndex}`}>{dayData.is_available ? "Open" : "Closed"}</Label>
                    </div>
                    <button onClick={() => setIsExpanded(!isExpanded)} className="focus:outline-none">
                        {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                </div>
            </div>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-4 pt-4 border-t border-white/20 space-y-4 text-sm">
                            {renderTimeInputs()}
                             {dayData.is_available && service.service_type === 'window' && (
                                <div className="text-right mt-2">
                                    <Button onClick={() => handleSave()} size="sm" disabled={isSaving}>
                                        <Save className="mr-2 h-4 w-4" /> 
                                        {isSaving ? 'Saving...' : 'Save Window'}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const ServiceAvailabilityCard = ({ service, availability, onSaveChanges }) => {
    const daysOfWeek = useMemo(() => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], []);

    const handleDaySave = useCallback(async (dayDataFromChild) => {
        const payload = {
            service_id: service.id,
            day_of_week: dayDataFromChild.day_of_week,
            is_available: dayDataFromChild.is_available,
            window_start_time: null,
            window_end_time: null,
        };

        if (dayDataFromChild.is_available) {
            if (service.service_type === 'window') {
                payload.window_start_time = dayDataFromChild.window_start_time;
                payload.window_end_time = dayDataFromChild.window_end_time;
            }
        }
        
        await onSaveChanges(payload);
    }, [service.id, service.service_type, onSaveChanges]);

    return (
        <div className="bg-white/5 p-6 rounded-2xl shadow-lg border border-white/10 h-full flex flex-col">
            <div className="flex items-center mb-4">
                <Truck className="h-6 w-6 text-yellow-400" />
                <h3 className="text-xl font-bold text-yellow-400 ml-3">{service.name}</h3>
            </div>
            <div className="flex-grow space-y-2 overflow-y-auto pr-2">
                {daysOfWeek.map((dayName, index) => {
                    const dayData = availability.find(d => d.day_of_week === index) || {
                        service_id: service.id, 
                        day_of_week: index, 
                        is_available: false,
                        window_start_time: null,
                        window_end_time: null,
                    };
                    return (
                        <DayAvailability
                            key={index}
                            dayName={dayName}
                            dayIndex={index}
                            service={service}
                            initialDayData={dayData}
                            onSaveChanges={handleDaySave}
                        />
                    );
                })}
            </div>
        </div>
    );
};