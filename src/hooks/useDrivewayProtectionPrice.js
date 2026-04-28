import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Driveway Protection Pricing Hook
 * Loads driveway protection price from business_settings table
 * Default price: $15.00 (hardcoded fallback)
 * 
 * IMPORTANT: This hook ONLY performs SELECT queries.
 * It does NOT attempt to INSERT settings into business_settings.
 * Admin must manually create the setting via SettingsManager.
 */

const DEFAULT_DRIVEWAY_PRICE = 15.00;
const SETTING_KEY = 'driveway_protection_price';

export const useDrivewayProtectionPrice = () => {
    const [drivewayPrice, setDrivewayPrice] = useState(DEFAULT_DRIVEWAY_PRICE);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchPricing = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            console.log('[Driveway Protection Pricing] Fetching price from business_settings');
            
            // Fetch from business_settings table (SELECT only, no INSERT)
            const { data, error: fetchError } = await supabase
                .from('business_settings')
                .select('setting_value')
                .eq('setting_key', SETTING_KEY)
                .maybeSingle();

            if (fetchError) {
                console.warn('[Driveway Protection Pricing] Error fetching setting:', fetchError.message);
                // Use default on error
                setDrivewayPrice(DEFAULT_DRIVEWAY_PRICE);
                console.log('[Driveway Protection Pricing] Using default price:', DEFAULT_DRIVEWAY_PRICE);
            } else if (data && data.setting_value && data.setting_value.price) {
                const price = Number(data.setting_value.price);
                setDrivewayPrice(price);
                console.log('[Driveway Protection Pricing] ✓ Loaded price from database:', price);
            } else {
                // No setting found, use default
                setDrivewayPrice(DEFAULT_DRIVEWAY_PRICE);
                console.log('[Driveway Protection Pricing] No setting found, using default:', DEFAULT_DRIVEWAY_PRICE);
            }
        } catch (err) {
            console.warn('[Driveway Protection Pricing] Unexpected error:', err.message);
            setError(err.message);
            // Use default price on error
            setDrivewayPrice(DEFAULT_DRIVEWAY_PRICE);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPricing();
    }, [fetchPricing]);

    const updateDrivewayPrice = async (newPrice) => {
        if (newPrice < 0) {
            console.error('[Driveway Protection Pricing] Invalid price:', newPrice);
            return false;
        }

        try {
            console.log('[Driveway Protection Pricing] Updating price to:', newPrice);

            // Check if setting exists
            const { data: existing } = await supabase
                .from('business_settings')
                .select('id')
                .eq('setting_key', SETTING_KEY)
                .maybeSingle();

            if (existing) {
                // Update existing setting
                const { error } = await supabase
                    .from('business_settings')
                    .update({
                        setting_value: { price: Number(newPrice) },
                        updated_at: new Date().toISOString()
                    })
                    .eq('setting_key', SETTING_KEY);

                if (error) throw error;
            } else {
                // Setting doesn't exist - admin must create it manually
                console.warn('[Driveway Protection Pricing] Setting does not exist. Admin must create it in Settings Manager.');
                return false;
            }

            setDrivewayPrice(Number(newPrice));
            console.log('[Driveway Protection Pricing] ✓ Price updated successfully');
            return true;
        } catch (error) {
            console.error('[Driveway Protection Pricing] Error updating price:', error);
            return false;
        }
    };

    return { 
        drivewayPrice, 
        loading, 
        error,
        updateDrivewayPrice, 
        fetchPricing 
    };
};