import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getReviewImageUrls, resolveReviewMediaUrl } from '@/utils/reviewMediaHelper';

export const ReviewMediaDisplay = ({
    imageUrls,
    videoUrl,
    maxImages = 3,
    className = '',
    imageClassName = 'h-20 w-20 rounded-md object-cover border border-white/10',
    videoClassName = 'w-full max-h-48 rounded-md border border-white/10',
}) => {
    const [resolvedImages, setResolvedImages] = useState([]);
    const [resolvedVideo, setResolvedVideo] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadMedia = async () => {
            const hasImages = imageUrls?.length > 0;
            const hasVideo = Boolean(videoUrl);
            if (!hasImages && !hasVideo) {
                setResolvedImages([]);
                setResolvedVideo(null);
                return;
            }

            setLoading(true);
            try {
                const [images, video] = await Promise.all([
                    hasImages ? getReviewImageUrls(imageUrls) : Promise.resolve([]),
                    hasVideo ? resolveReviewMediaUrl(videoUrl) : Promise.resolve(null),
                ]);

                if (!cancelled) {
                    setResolvedImages(images);
                    setResolvedVideo(video);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadMedia();
        return () => { cancelled = true; };
    }, [imageUrls, videoUrl]);

    if (loading) {
        return (
            <div className={`flex items-center gap-2 text-gray-400 text-xs ${className}`}>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading media...
            </div>
        );
    }

    if (!resolvedImages.length && !resolvedVideo) return null;

    const visibleImages = resolvedImages.slice(0, maxImages);
    const extraCount = resolvedImages.length - visibleImages.length;

    return (
        <div className={`space-y-3 ${className}`}>
            {visibleImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {visibleImages.map((url, index) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={`Review photo ${index + 1}`} className={imageClassName} />
                        </a>
                    ))}
                    {extraCount > 0 && (
                        <span className="text-xs text-gray-400 self-center">+{extraCount} more</span>
                    )}
                </div>
            )}
            {resolvedVideo && (
                <video src={resolvedVideo} controls className={videoClassName} preload="metadata">
                    Your browser does not support video playback.
                </video>
            )}
        </div>
    );
};
