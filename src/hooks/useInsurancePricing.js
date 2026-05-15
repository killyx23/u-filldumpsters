
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

/**
 * Insurance Pricing Hook
 * Loads Premium Insurance pricing from services table using ID 7
 * Services ID 7 = Premium Insurance
 * Default price: $20.00 (hardcoded fallback)
 * 
 * MIGRATION NOTE: Premium Insurance pricing has been moved from equipment table to services table
 * to maintain consistency with other service pricing.
 */

// Premium Insurance Service ID
const INSURANCE_SERVICE_ID = 7;
const DEFAULT_INSURANCE_PRICE = 20.00;

export const useInsurancePricing = () => {
    const [insurancePrice, setInsurancePrice] = useState(DEFAULT_INSURANCE_PRICE);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchPricing = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            console.log('[Insurance Pricing] Fetching Premium Insurance pricing from services table (ID: 7)');
            
            // Get price from services table using ID 7
            const { data: insuranceService, error: serviceError } = await supabase
                .from('services')
                .select('base_price, name')
                .eq('id', INSURANCE_SERVICE_ID)
                .maybeSingle();

            if (serviceError) {
                console.warn('[Insurance Pricing] Error fetching from services table:', serviceError.message);
                throw serviceError;
            }

            if (insuranceService && insuranceService.base_price !== null && insuranceService.base_price !== undefined) {
                const priceFromService = Number(insuranceService.base_price);
                setInsurancePrice(priceFromService);
                console.log('[Insurance Pricing] ✓ Loaded Premium Insurance price from services table:', priceFromService);
            } else {
                // Service record doesn't exist or has no price - use default
                console.warn('[Insurance Pricing] Premium Insurance service (ID 7) not found or has no price, using default:', DEFAULT_INSURANCE_PRICE);
                setInsurancePrice(DEFAULT_INSURANCE_PRICE);
            }
        } catch (err) {
            console.error('[Insurance Pricing] Error loading insurance pricing:', err.message);
            setError(err.message);
            // Use hardcoded default on error
            setInsurancePrice(DEFAULT_INSURANCE_PRICE);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPricing();
    }, [fetchPricing]);

    const updateInsurancePrice = async (newPrice) => {
        if (newPrice < 0) {
            toast({ 
                title: 'Invalid Price', 
                description: 'Price must be a positive number.', 
                variant: 'destructive' 
            });
            return false;
        }

        try {
            console.log('[Insurance Pricing] Updating Premium Insurance price in services table (ID: 7) to:', newPrice);

            // Update services table base_price for Premium Insurance
            const { error: updateError } = await supabase
                .from('services')
                .update({ base_price: Number(newPrice) })
                .eq('id', INSURANCE_SERVICE_ID);

            if (updateError) {
                console.error('[Insurance Pricing] Error updating services table:', updateError);
                throw updateError;
            }

            setInsurancePrice(Number(newPrice));
            console.log('[Insurance Pricing] ✓ Premium Insurance price updated successfully in services table');
            
            toast({ 
                title: 'Success', 
                description: 'Premium Insurance price updated successfully.' 
            });
            return true;
        } catch (error) {
            console.error('[Insurance Pricing] Error updating price:', error);
            toast({ 
                title: 'Error', 
                description: 'Failed to update Premium Insurance price.', 
                variant: 'destructive' 
            });
            return false;
        }
    };

    return { 
        insurancePrice, 
        insuranceServiceId: INSURANCE_SERVICE_ID,
        loading, 
        error,
        updateInsurancePrice, 
        fetchPricing 
    };
};
