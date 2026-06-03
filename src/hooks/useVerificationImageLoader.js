import { useState, useEffect, useCallback } from 'react';
import { getMergedVerificationDocumentsByCustomerId, downloadVerificationImage } from '@/utils/verificationImageHelper';
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
            const doc = await getMergedVerificationDocumentsByCustomerId(customerId);
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