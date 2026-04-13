
import { useCallback } from 'react';
import { calculateRescheduleFee } from '@/utils/rescheduleCalculations';
import { differenceInCalendarDays, parseISO } from 'date-fns';

export const useRescheduleCalculations = () => {
    const getRescheduleDetails = useCallback((booking, newDropOffDate, newDropOffTime, currentPriceDifference = 0) => {
        if (!booking || !newDropOffDate) return null;

        // Combine date and time for original appointment
        let originalApptString = booking.drop_off_date;
        if (booking.drop_off_time_slot && !booking.drop_off_time_slot.includes('T')) {
             originalApptString += `T${booking.drop_off_time_slot}`;
        }
        
        const requestTime = new Date(); // right now
        const baseTotal = booking.total_price || 0;
        
        // The fee is based on the original total price (or current base total)
        const { feeApplies, feeAmount, timeDifferenceHours } = calculateRescheduleFee(
            baseTotal,
            originalApptString,
            requestTime.toISOString()
        );

        // Include any price difference based on new duration vs old duration
        const totalChange = feeAmount + currentPriceDifference;
        const newTotal = baseTotal + totalChange;

        const newAppointmentTime = newDropOffDate.toISOString().split('T')[0] + (newDropOffTime ? `T${newDropOffTime}` : 'T00:00:00');

        const rescheduleHistoryEntry = {
            original_appointment_time: originalApptString,
            reschedule_request_time: requestTime.toISOString(),
            new_appointment_time: newAppointmentTime,
            fee_applied: feeApplies,
            fee_amount: feeAmount,
            original_total: baseTotal,
            new_total: newTotal
        };

        return {
            feeApplies,
            feeAmount,
            newTotal,
            totalChange,
            timeDifferenceHours,
            rescheduleHistoryEntry
        };
    }, []);

    return { getRescheduleDetails };
};
