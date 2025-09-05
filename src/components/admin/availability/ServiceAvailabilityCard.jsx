import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { DayAvailability } from './DayAvailability';

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const ServiceAvailabilityCard = ({ service, availability, onSaveChanges }) => {
    const [weeklyAvailability, setWeeklyAvailability] = useState([]);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        const initialAvailability = weekdays.map((dayName, index) => {
            const existing = availability.find(a => a.day_of_week === index);
            return {
                name: dayName,
                day_of_week: index,
                is_available: existing?.is_available || false,
                day_start_time: existing?.day_start_time || null,
                day_end_time: existing?.day_end_time || null,
                time_windows: existing?.time_windows || (service.service_type === 'window' ? [] : null),
            };
        });
        setWeeklyAvailability(initialAvailability);
    }, [service, availability]);

    const handleDayUpdate = (updatedDay) => {
        setWeeklyAvailability(prev => prev.map(day => day.day_of_week === updatedDay.day_of_week ? updatedDay : day));
        setHasChanges(true);
    };

    const handleSave = () => {
        const payload = weeklyAvailability.map(day => ({
            service_id: service.id,
            day_of_week: day.day_of_week,
            is_available: day.is_available,
            day_start_time: service.service_type === 'fullday' ? day.day_start_time : null,
            day_end_time: service.service_type === 'fullday' ? day.day_end_time : null,
            time_windows: service.service_type === 'window' ? day.time_windows : null,
        }));
        onSaveChanges(payload);
        setHasChanges(false);
    };
    
    return (
        <div className="bg-white/10 backdrop-blur-lg p-6 rounded-2xl shadow-xl border border-white/20 flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-bold text-yellow-400">{service.name}</h3>
                <Button onClick={handleSave} disabled={!hasChanges} size="sm" className="bg-green-600 hover:bg-green-700 disabled:bg-gray-500">
                    <Save className="h-4 w-4 mr-2" />
                    Save
                </Button>
            </div>
            <div className="space-y-4">
                {weeklyAvailability.map((day, index) => (
                    <DayAvailability
                        key={index}
                        day={day}
                        dayIndex={index}
                        onUpdate={handleDayUpdate}
                        serviceType={service.service_type}
                    />
                ))}
            </div>
        </div>
    );
};