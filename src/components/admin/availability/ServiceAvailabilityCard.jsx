
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
                delivery_start_time: existing?.delivery_start_time,
                delivery_end_time: existing?.delivery_end_time,
                pickup_start_time: existing?.pickup_start_time,
                pickup_end_time: existing?.pickup_end_time,
                delivery_pickup_start_time: existing?.delivery_pickup_window_start_time,
                delivery_pickup_end_time: existing?.delivery_pickup_window_end_time,
                return_start_time: existing?.return_start_time,
                return_end_time: existing?.return_end_time,
            };
        });
        setWeeklyAvailability(initialAvailability);
        setHasChanges(false);
    }, [service, availability]);

    const handleDayUpdate = (updatedDay) => {
        setWeeklyAvailability(prev => prev.map(day => day.day_of_week === updatedDay.day_of_week ? { ...day, ...updatedDay } : day));
        setHasChanges(true);
    };

    const handleSave = () => {
        const payload = weeklyAvailability.map(day => ({
            service_id: service.id,
            day_of_week: day.day_of_week,
            is_available: day.is_available,
            time_type: service.service_type,
            delivery_start_time: day.delivery_start_time,
            delivery_end_time: day.delivery_end_time,
            pickup_start_time: day.pickup_start_time,
            pickup_end_time: day.pickup_end_time,
            delivery_pickup_window_start_time: day.delivery_pickup_start_time,
            delivery_pickup_window_end_time: day.delivery_pickup_end_time,
            return_start_time: day.return_start_time,
            return_end_time: day.return_end_time,
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
                        serviceId={service.id}
                    />
                ))}
            </div>
        </div>
    );
};
