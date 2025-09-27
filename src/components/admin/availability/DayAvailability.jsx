import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { generateTimeSlotOptions } from '@/components/admin/availability/time-helpers';

const TimeRangeSelector = ({ label, startValue, endValue, onStartChange, onEndChange, options, serviceType }) => (
    <div>
        <Label className="text-blue-200 font-semibold mb-2 block">{label}</Label>
        <div className="grid grid-cols-2 gap-4">
            <div>
                <Label className="text-xs text-gray-400">Start Time</Label>
                <select
                    value={startValue || ''}
                    onChange={(e) => onStartChange(e.target.value)}
                    className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500 w-full"
                >
                    <option value="">Not Set</option>
                    {options.map(option => <option key={`start-${label}-${option.value}`} value={option.value}>{option.label}</option>)}
                </select>
            </div>
            <div>
                <Label className="text-xs text-gray-400">Stop Time</Label>
                <select
                    value={endValue || ''}
                    onChange={(e) => onEndChange(e.target.value)}
                    className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500 w-full"
                >
                    <option value="">Not Set</option>
                    {options.map(option => <option key={`end-${label}-${option.value}`} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </div>
    </div>
);

export const DayAvailability = ({ day, dayIndex, onUpdate, serviceType, timeConfig }) => {
    const [dayState, setDayState] = useState(day);

    const windowOptions = generateTimeSlotOptions(120);
    const hourlyOptions = generateTimeSlotOptions(60);

    useEffect(() => {
        setDayState(day);
    }, [day]);

    const handleDayStateChange = (field, value) => {
        const newState = { ...dayState, [field]: value };
        setDayState(newState);
        onUpdate({ day_of_week: dayIndex, ...newState });
    };

    const renderWindowSelectors = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {timeConfig.delivery && (
                <TimeRangeSelector
                    label="Delivery Window"
                    startValue={dayState.delivery_start_time}
                    endValue={dayState.delivery_end_time}
                    onStartChange={(val) => handleDayStateChange('delivery_start_time', val)}
                    onEndChange={(val) => handleDayStateChange('delivery_end_time', val)}
                    options={windowOptions}
                    serviceType={serviceType}
                />
            )}
            {timeConfig.pickup && (
                <TimeRangeSelector
                    label="Pickup Window"
                    startValue={dayState.pickup_start_time}
                    endValue={dayState.pickup_end_time}
                    onStartChange={(val) => handleDayStateChange('pickup_start_time', val)}
                    onEndChange={(val) => handleDayStateChange('pickup_end_time', val)}
                    options={windowOptions}
                    serviceType={serviceType}
                />
            )}
        </div>
    );

    const renderHourlySelectors = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {timeConfig.pickup && (
                <TimeRangeSelector
                    label="Pickup Window"
                    startValue={dayState.hourly_start_time}
                    endValue={dayState.hourly_end_time}
                    onStartChange={(val) => handleDayStateChange('hourly_start_time', val)}
                    onEndChange={(val) => handleDayStateChange('hourly_end_time', val)}
                    options={hourlyOptions}
                    serviceType={serviceType}
                />
            )}
            {timeConfig.return && (
                 <TimeRangeSelector
                    label="Return Window"
                    startValue={dayState.return_start_time}
                    endValue={dayState.return_end_time}
                    onStartChange={(val) => handleDayStateChange('return_start_time', val)}
                    onEndChange={(val) => handleDayStateChange('return_end_time', val)}
                    options={hourlyOptions}
                    serviceType={serviceType}
                />
            )}
        </div>
    );

    return (
        <div className="space-y-4 p-4 bg-white/5 rounded-lg">
            <div className="flex items-center justify-between">
                <p className="font-bold text-lg text-white">{day.name}</p>
                <div className="flex items-center space-x-2">
                    <Label htmlFor={`switch-${day.name}-${dayIndex}`} className={dayState.is_available ? 'text-green-400' : 'text-gray-400'}>
                        {dayState.is_available ? 'Open' : 'Closed'}
                    </Label>
                    <Switch
                        id={`switch-${day.name}-${dayIndex}`}
                        checked={dayState.is_available}
                        onCheckedChange={(checked) => handleDayStateChange('is_available', checked)}
                        aria-label={`Toggle availability for ${day.name}`}
                    />
                </div>
            </div>

            {dayState.is_available && (
                <div className="space-y-4 pt-3 border-t border-white/10">
                    {serviceType === 'window' ? renderWindowSelectors() : renderHourlySelectors()}
                </div>
            )}
        </div>
    );
};