
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { getPriceForEquipment, updateEquipmentPrice } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

/**
 * Insurance Pricing Hook
 * Loads insurance pricing from equipment_pricing table using numeric ID 7
 * Equipment ID 7 = Premium Insurance
 * Default price: $20.00 (hardcoded fallback)
 * 
 * IMPORTANT: This hook ONLY performs SELECT and UPDATE queries.
 * It does NOT attempt to INSERT into business_settings or any other table.
 */

// Premium Insurance Equipment ID (numeric)
const INSURANCE_EQUIPMENT_ID = 7;
const DEFAULT_INSURANCE_PRICE = 20.00;

export const useInsurancePricing = () => {
    const [insurancePrice, setInsurancePrice] = useState(DEFAULT_INSURANCE_PRICE);
    const [insuranceEquipmentId, setInsuranceEquipmentId] = useState(INSURANCE_EQUIPMENT_ID);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchPricing = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            console.log('[Insurance Pricing] Fetching insurance pricing for equipment ID:', INSURANCE_EQUIPMENT_ID);
            
            // Validate equipment ID
            if (!isValidEquipmentId(INSURANCE_EQUIPMENT_ID)) {
                throw new Error('Invalid insurance equipment ID (expected 7)');
            }

            setInsuranceEquipmentId(INSURANCE_EQUIPMENT_ID);

            // Get price from equipment_pricing table using numeric ID (SELECT only)
            const priceFromTable = await getPriceForEquipment(INSURANCE_EQUIPMENT_ID);
            
            if (priceFromTable > 0) {
                setInsurancePrice(priceFromTable);
                console.log('[Insurance Pricing] ✓ Loaded price from equipment_pricing:', priceFromTable);
            } else {
                // Try fallback price from equipment table (SELECT only)
                const { data: insuranceEquipment, error: equipError } = await supabase
                    .from('equipment')
                    .select('price')
                    .eq('id', INSURANCE_EQUIPMENT_ID)
                    .maybeSingle();

                if (equipError) {
                    console.warn('[Insurance Pricing] Failed to fetch fallback price:', equipError.message);
                    // Use hardcoded default
                    setInsurancePrice(DEFAULT_INSURANCE_PRICE);
                    console.log('[Insurance Pricing] Using hardcoded default:', DEFAULT_INSURANCE_PRICE);
                } else if (insuranceEquipment && insuranceEquipment.price) {
                    const fallbackPrice = Number(insuranceEquipment.price);
                    setInsurancePrice(fallbackPrice);
                    console.log('[Insurance Pricing] Using fallback price from equipment table:', fallbackPrice);
                } else {
                    // Use hardcoded default
                    setInsurancePrice(DEFAULT_INSURANCE_PRICE);
                    console.log('[Insurance Pricing] No price found, using hardcoded default:', DEFAULT_INSURANCE_PRICE);
                }
            }
        } catch (err) {
            console.warn('[Insurance Pricing] Error loading insurance pricing:', err.message);
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
            console.log('[Insurance Pricing] Updating price for equipment ID:', INSURANCE_EQUIPMENT_ID);

            // Update using numeric ID (UPDATE only, no INSERT)
            const result = await updateEquipmentPrice(
                INSURANCE_EQUIPMENT_ID, 
                Number(newPrice), 
                'insurance',
                null,
                'Insurance price update via admin'
            );

            if (!result.success) {
                throw new Error(result.error || 'Failed to update price');
            }

            setInsurancePrice(Number(newPrice));
            toast({ 
                title: 'Success', 
                description: 'Insurance price updated successfully.' 
            });
            return true;
        } catch (error) {
            console.error('[Insurance Pricing] Error updating price:', error);
            toast({ 
                title: 'Error', 
                description: 'Failed to update insurance price.', 
                variant: 'destructive' 
            });
            return false;
        }
    };

    return { 
        insurancePrice, 
        insuranceEquipmentId: INSURANCE_EQUIPMENT_ID,
        loading, 
        error,
        updateInsurancePrice, 
        fetchPricing 
    };
};
