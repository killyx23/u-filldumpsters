import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { getVerificationDocumentsByCustomerId, downloadVerificationImage } from '@/utils/verificationImageHelper';
import { toast } from '@/components/ui/use-toast';

export function useVerificationImageLoader(customerId) {
    const [images, setImages] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchImages = useCallback(async () => {
        if (!customerId) {
            setImages(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // First check driver_verification_documents
            let doc = await getVerificationDocumentsByCustomerId(customerId);
            
            // If missing in new table, check legacy customers table (which ComprehensiveHistory uses)
            if (!doc) {
                const { data: customerData, error: customerError } = await supabase
                    .from('customers')
                    .select('license_image_urls')
                    .eq('id', customerId)
                    .single();
                
                if (customerData?.license_image_urls?.length > 0) {
                    const frontImg = customerData.license_image_urls[0];
                    const backImg = customerData.license_image_urls.length > 1 ? customerData.license_image_urls[1] : null;
                    
                    doc = {
                        customer_id: customerId,
                        license_front_url: frontImg?.url,
                        license_front_storage_path: frontImg?.path,
                        license_back_url: backImg?.url,
                        license_back_storage_path: backImg?.path,
                        verification_status: 'legacy'
                    };
                }
            }

            setImages(doc);
        } catch (err) {
            console.error('Error fetching verification images:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        fetchImages();
    }, [fetchImages]);

    const downloadImage = async (path, filename) => {
        try {
            await downloadVerificationImage(path, filename);
        } catch (err) {
            toast({ title: 'Download Failed', description: err.message, variant: 'destructive' });
        }
    };

    return { images, loading, error, downloadImage, refetch: fetchImages };
}