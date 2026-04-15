import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export function useVerificationImageHistory(customerId) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchHistory = useCallback(async () => {
        if (!customerId) {
            setHistory([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: fetchError } = await supabase
                .from('verification_image_history')
                .select('*')
                .eq('customer_id', customerId)
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;
            setHistory(data || []);
        } catch (err) {
            console.error('Error fetching verification history:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    return { history, loading, error, refetchHistory: fetchHistory };
}