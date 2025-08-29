
import React, { useState, useMemo, useEffect } from 'react';
import { Truck, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTime, timeOptions, timeWindowOptions } from './time-helpers';

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

const TimeSelector = ({ value, onChange, options, placeholder = "Select time" }) => (
    <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="bg-white/20">
            <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
            {options.map(time => (
                <SelectItem key={time} value={time}>{formatTime(time)}</SelectItem>
            ))}
        </SelectContent>
    </Select>
);

const DayAvailability = ({ dayName, dayIndex, service, initialDayData, onSaveChanges }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [dayData, setDayData] = useState(initialDayData);

    useEffect(() => {
        setDayData(initialDayData);
    }, [initialDayData]);

    const handleSwitchChange = (checked) => {
        const updatedDayData = { ...dayData, is_available: checked };
        setDayData(updatedDayData);
        onSaveChanges(updatedDayData);
    };

    const handleTimeChange = (field, value) => {
        setDayData(prev => ({ ...prev, [field]: value }));
    };

    const handleTimeWindowChange = (startField, endField, value) => {
        if (!value) return;
        const [start, end] = value.split('-');
        setDayData(prev => ({ ...prev, [startField]: start, [endField]: end }));
    };

    const handleSaveTimeClick = () => {
        onSaveChanges(dayData);
    };

    const renderTimeInputs = () => {
        switch (service.id) {
            case 1: // 16yd Dumpster Rental
                return (
                    <>
                        <div>
                            <p className="font-semibold text-blue-200 mb-1">Drop Off Window</p>
                            <TimeWindowSelector
                                options={timeWindowOptions}
                                value={dayData.delivery_start_time && dayData.delivery_end_time ? `${dayData.delivery_start_time}-${dayData.delivery_end_time}` : ''}
                                onChange={v => handleTimeWindowChange('delivery_start_time', 'delivery_end_time', v)}
                            />
                        </div>
                        <div>
                            <p className="font-semibold text-blue-200 mb-1">Pickup Window</p>
                            <TimeWindowSelector
                                options={timeWindowOptions}
                                value={dayData.pickup_start_time && dayData.pickup_end_time ? `${dayData.pickup_start_time}-${dayData.pickup_end_time}` : ''}
                                onChange={v => handleTimeWindowChange('pickup_start_time', 'pickup_end_time', v)}
                            />
                        </div>
                    </>
                );
            case 2: // Dump Loader Trailer Rental Service
                return (
                    <>
                        <div>
                            <p className="font-semibold text-blue-200 mb-1">Pickup Time</p>
                            <div className="grid grid-cols-2 gap-2">
                                <TimeSelector options={timeOptions} value={dayData.delivery_start_time} onChange={v => handleTimeChange('delivery_start_time', v)} />
                                <TimeSelector options={timeOptions} value={dayData.delivery_end_time} onChange={v => handleTimeChange('delivery_end_time', v)} />
                            </div>
                        </div>
                        <div>
                            <p className="font-semibold text-blue-200 mb-1">Return Time</p>
                            <div className="grid grid-cols-2 gap-2">
                                <TimeSelector options={timeOptions} value={dayData.pickup_start_time} onChange={v => handleTimeChange('pickup_start_time', v)} />
                                <TimeSelector options={timeOptions} value={dayData.pickup_end_time} onChange={v => handleTimeChange('pickup_end_time', v)} />
                            </div>
                        </div>
                    </>
                );
            case 3: // Rock, Mulch, Gravel
                return (
                    <div>
                        <p className="font-semibold text-blue-200 mb-1">Delivery Window</p>
                        <TimeWindowSelector
                            options={timeWindowOptions}
                            value={dayData.delivery_start_time && dayData.delivery_end_time ? `${dayData.delivery_start_time}-${dayData.delivery_end_time}` : ''}
                            onChange={v => handleTimeWindowChange('delivery_start_time', 'delivery_end_time', v)}
                        />
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="bg-white/10 p-3 rounded-md transition-all duration-300">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                <Label className="text-lg font-semibold">{dayName}</Label>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Switch id={`available-${service.id}-${dayIndex}`} checked={dayData.is_available} onCheckedChange={handleSwitchChange} />
                        <Label htmlFor={`available-${service.id}-${dayIndex}`}>{dayData.is_available ? "Open" : "Closed"}</Label>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="focus:outline-none">
                        {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                </div>
            </div>
            <AnimatePresence>
                {isExpanded && dayData.is_available && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-4 pt-4 border-t border-white/20 space-y-4 text-sm">
                            {renderTimeInputs()}
                            <div className="text-right mt-2">
                                <Button onClick={handleSaveTimeClick} size="sm"><Save className="mr-2 h-4 w-4" /> Save Time Changes</Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const ServiceAvailabilityCard = ({ service, availability, onSaveChanges }) => {
    const daysOfWeek = useMemo(() => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], []);

    return (
        <div className="bg-white/5 p-6 rounded-2xl shadow-lg border border-white/10 h-full flex flex-col">
            <div className="flex items-center mb-4">
                <Truck className="h-6 w-6 text-yellow-400" />
                <h3 className="text-xl font-bold text-yellow-400 ml-3">{service.name}</h3>
            </div>
            <div className="flex-grow space-y-2 overflow-y-auto pr-2">
                {daysOfWeek.map((dayName, index) => {
                    const dayData = availability.find(d => d.day_of_week === index) || {
                        service_id: service.id, day_of_week: index, is_available: false, 
                        delivery_start_time: '08:00', delivery_end_time: '10:00',
                        pickup_start_time: '08:00', pickup_end_time: '10:00',
                    };
                    return (
                        <DayAvailability
                            key={index}
                            dayName={dayName}
                            dayIndex={index}
                            service={service}
                            initialDayData={dayData}
                            onSaveChanges={onSaveChanges}
                        />
                    );
                })}
            </div>
        </div>
    );
};
