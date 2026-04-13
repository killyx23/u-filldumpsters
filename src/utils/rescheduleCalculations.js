
import { differenceInHours, parseISO, isValid } from 'date-fns';

export const calculateRescheduleFee = (originalOrderTotal, originalAppointmentTime, rescheduleRequestTime) => {
    if (!originalOrderTotal || !originalAppointmentTime || !rescheduleRequestTime) {
        return { feeApplies: false, feeAmount: 0, newTotal: originalOrderTotal || 0, timeDifferenceHours: 999 };
    }

    const apptDate = typeof originalAppointmentTime === 'string' ? parseISO(originalAppointmentTime) : originalAppointmentTime;
    const requestDate = typeof rescheduleRequestTime === 'string' ? parseISO(rescheduleRequestTime) : rescheduleRequestTime;

    if (!isValid(apptDate) || !isValid(requestDate)) {
         return { feeApplies: false, feeAmount: 0, newTotal: originalOrderTotal || 0, timeDifferenceHours: 999 };
    }

    const timeDifferenceHours = differenceInHours(apptDate, requestDate);
    const feeApplies = timeDifferenceHours < 24 && timeDifferenceHours >= 0;
    const feeAmount = feeApplies ? originalOrderTotal * 0.05 : 0;
    
    return {
        feeApplies,
        feeAmount,
        newTotal: originalOrderTotal + feeAmount,
        timeDifferenceHours
    };
};

export const formatRescheduleMessage = (feeApplies, feeAmount) => {
    if (feeApplies) {
        return `A 5% reschedule fee ($${feeAmount.toFixed(2)}) will apply since you are rescheduling within 24 hours of your appointment.`;
    }
    return `No reschedule fee - rescheduling more than 24 hours in advance.`;
};
