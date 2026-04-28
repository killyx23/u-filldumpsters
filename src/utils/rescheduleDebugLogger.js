/**
 * Comprehensive logging utility to verify Supabase data connections 
 * and pricing calculations for the rescheduling flow.
 */

export const rescheduleDebugLogger = {
    logOriginalBooking: (booking) => {
        console.group('%c[RESCHEDULE DEBUG] Fetching original booking...', 'color: #3b82f6; font-weight: bold;');
        console.log('Booking ID:', booking?.id);
        console.log('Customer ID:', booking?.customer_id);
        console.log('Original Service ID:', booking?.plan?.id);
        console.log('Original Dates:', { dropOff: booking?.drop_off_date, pickup: booking?.pickup_date });
        console.log('Original Add-ons (JSONB):', booking?.addons);
        console.groupEnd();
    },

    logServicePricingQuery: (serviceId, data, error) => {
        console.group(`%c[RESCHEDULE DEBUG] Querying pricing_services (services) table for Service ID: ${serviceId}`, 'color: #8b5cf6; font-weight: bold;');
        if (error) console.error('Query Error:', error);
        else console.log('Data returned:', data);
        console.groupEnd();
    },

    logAddonsQuery: (data, error) => {
        console.group('%c[RESCHEDULE DEBUG] Querying booking_addons / equipment_pricing tables', 'color: #10b981; font-weight: bold;');
        if (error) console.error('Query Error:', error);
        else console.log('Add-ons data returned:', data);
        console.groupEnd();
    },

    logAvailabilityQuery: (serviceId, data, error) => {
        console.group(`%c[RESCHEDULE DEBUG] Querying date_specific_availability for Service ID: ${serviceId}`, 'color: #f59e0b; font-weight: bold;');
        if (error) console.error('Query Error:', error);
        else console.log('Availability data returned:', data);
        console.groupEnd();
    },

    logPricingCalculations: (calcData) => {
        console.group('%c[RESCHEDULE DEBUG] Pricing Calculations Summary', 'color: #ec4899; font-weight: bold;');
        console.table({
            'Original Service Cost': calcData.originalServiceCost,
            'Original Addons Total': calcData.originalAddonsCost,
            'Original Total': calcData.originalTotal,
            'New Service Cost': calcData.newServiceCost,
            'Service Difference': calcData.serviceDifference,
            'New Addons Total': calcData.newAddonsCost,
            'New Subtotal': calcData.newSubtotal,
            'Tax Amount': calcData.taxAmount,
            'Final Amount Due': calcData.finalAmountDue
        });
        console.groupEnd();
    }
};