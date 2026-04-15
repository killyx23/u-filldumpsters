
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

export const useInsurancePricing = () => {
    const [insurancePrice, setInsurancePrice] = useState(20);
    const [loading, setLoading] = useState(true);

    const fetchPricing = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('business_settings')
                .select('setting_value')
                .eq('setting_key', 'insurance_price')
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data?.setting_value?.price !== undefined) {
                setInsurancePrice(Number(data.setting_value.price));
            }
        } catch (error) {
            console.error('Error fetching insurance pricing:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPricing();
    }, [fetchPricing]);

    const updateInsurancePrice = async (newPrice) => {
        if (newPrice < 0) {
            toast({ title: 'Invalid Price', description: 'Price must be a positive number.', variant: 'destructive' });
            return false;
        }

        try {
            const { data: existing } = await supabase
                .from('business_settings')
                .select('id')
                .eq('setting_key', 'insurance_price')
                .single();

            if (existing) {
                const { error } = await supabase
                    .from('business_settings')
                    .update({ setting_value: { price: Number(newPrice) }, updated_at: new Date().toISOString() })
                    .eq('setting_key', 'insurance_price');
                if (error) throw error;
            } else {
                 const { error } = await supabase
                    .from('business_settings')
                    .insert([{ id: 1001, setting_key: 'insurance_price', setting_value: { price: Number(newPrice) } }]);
                if (error) throw error;
            }

            setInsurancePrice(Number(newPrice));
            toast({ title: 'Success', description: 'Insurance price updated successfully.' });
            return true;
        } catch (error) {
            console.error('Error updating insurance pricing:', error);
            toast({ title: 'Error', description: 'Failed to update insurance price.', variant: 'destructive' });
            return false;
        }
    };

    return { insurancePrice, loading, updateInsurancePrice, fetchPricing };
};
