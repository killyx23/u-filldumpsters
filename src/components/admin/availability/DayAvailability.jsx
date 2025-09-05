import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { timeOptions, formatTimeToDisplay, isValidTime } from '@/components/admin/availability/time-helpers';

export const DayAvailability = ({ day, dayIndex, onUpdate, serviceType }) => {
    const [isOpen, setIsOpen] = useState(day.is_available);
    const [timeRanges, setTimeRanges] = useState([]);

    useEffect(() => {
        setIsOpen(day.is_available);
        if (serviceType === 'window' && Array.isArray(day.time_windows)) {
            setTimeRanges(day.time_windows);
        } else if (serviceType === 'fullday' && day.day_start_time && day.day_end_time) {
            setTimeRanges([{ start: day.day_start_time, end: day.day_end_time }]);
        } else {
             setTimeRanges(serviceType === 'fullday' ? [{ start: '08:00:00', end: '22:00:00'}] : []);
        }
    }, [day, serviceType]);

    const handleOpenChange = (checked) => {
        setIsOpen(checked);
        const updatedDay = {
            day_of_week: dayIndex,
            is_available: checked,
            time_windows: serviceType === 'window' ? timeRanges : null,
            day_start_time: serviceType === 'fullday' && timeRanges.length > 0 ? timeRanges[0].start : null,
            day_end_time: serviceType === 'fullday' && timeRanges.length > 0 ? timeRanges[0].end : null,
        };
        onUpdate(updatedDay);
    };

    const handleTimeChange = (index, type, value) => {
        const newTimeRanges = [...timeRanges];
        newTimeRanges[index][type] = value;
        setTimeRanges(newTimeRanges);
    };

    const addTimeRange = () => {
        setTimeRanges([...timeRanges, { start: '08:00:00', end: '10:00:00' }]);
    };

    const removeTimeRange = (index) => {
        const newTimeRanges = timeRanges.filter((_, i) => i !== index);
        setTimeRanges(newTimeRanges);
    };

    const handleBlur = () => {
        const updatedDay = {
            day_of_week: dayIndex,
            is_available: isOpen,
            time_windows: serviceType === 'window' ? timeRanges.filter(t => isValidTime(t.start) && isValidTime(t.end)) : null,
            day_start_time: serviceType === 'fullday' && timeRanges.length > 0 && isValidTime(timeRanges[0].start) ? timeRanges[0].start : null,
            day_end_time: serviceType === 'fullday' && timeRanges.length > 0 && isValidTime(timeRanges[0].end) ? timeRanges[0].end : null,
        };
        onUpdate(updatedDay);
    };
    
    return (
        <div className="space-y-4 p-4 bg-white/5 rounded-lg">
            <div className="flex items-center justify-between">
                <p className="font-bold text-lg text-white">{day.name}</p>
                <div className="flex items-center space-x-2">
                    <Label htmlFor={`switch-${dayIndex}`} className={isOpen ? 'text-green-400' : 'text-gray-400'}>
                        {isOpen ? 'Open' : 'Closed'}
                    </Label>
                    <Switch
                        id={`switch-${dayIndex}`}
                        checked={isOpen}
                        onCheckedChange={handleOpenChange}
                        aria-label={`Toggle availability for ${day.name}`}
                    />
                </div>
            </div>

            {isOpen && (
                <div className="space-y-3 pt-3 border-t border-white/10">
                    {serviceType === 'fullday' && (
                        <div className="flex items-center space-x-2">
                            <Clock className="h-4 w-4 text-gray-400" />
                            <select
                                value={timeRanges[0]?.start || ''}
                                onChange={(e) => handleTimeChange(0, 'start', e.target.value)}
                                onBlur={handleBlur}
                                className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500"
                            >
                                {timeOptions().map(option => <option key={`start-${option}`} value={option}>{formatTimeToDisplay(option)}</option>)}
                            </select>
                            <span>to</span>
                            <select
                                value={timeRanges[0]?.end || ''}
                                onChange={(e) => handleTimeChange(0, 'end', e.target.value)}
                                onBlur={handleBlur}
                                className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500"
                            >
                                {timeOptions().map(option => <option key={`end-${option}`} value={option}>{formatTimeToDisplay(option)}</option>)}
                            </select>
                        </div>
                    )}
                    {serviceType === 'window' && (
                        <>
                            {timeRanges.map((range, index) => (
                                <div key={index} className="flex items-center space-x-2">
                                    <Clock className="h-4 w-4 text-gray-400" />
                                    <select
                                        value={range.start}
                                        onChange={(e) => handleTimeChange(index, 'start', e.target.value)}
                                        onBlur={handleBlur}
                                        className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500"
                                    >
                                        {timeOptions().map(option => <option key={`start-${index}-${option}`} value={option}>{formatTimeToDisplay(option)}</option>)}
                                    </select>
                                    <span>to</span>
                                    <select
                                        value={range.end}
                                        onChange={(e) => handleTimeChange(index, 'end', e.target.value)}
                                        onBlur={handleBlur}
                                        className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500"
                                    >
                                        {timeOptions().map(option => <option key={`end-${index}-${option}`} value={option}>{formatTimeToDisplay(option)}</option>)}
                                    </select>
                                    <Button size="icon" variant="ghost" onClick={() => removeTimeRange(index)} className="text-red-500 hover:text-red-400">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={addTimeRange} className="text-yellow-400 border-yellow-400 hover:bg-yellow-400 hover:text-black">
                                <Plus className="h-4 w-4 mr-2"/> Add Time Window
                            </Button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};