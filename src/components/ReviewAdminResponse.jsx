import React from 'react';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { ReviewMediaDisplay } from '@/components/ReviewMediaDisplay';

export const ReviewAdminResponse = ({
    review,
    className = '',
    titleClassName = 'text-blue-300',
    textClassName = 'text-blue-100',
}) => {
    const hasResponse =
        Boolean(review?.admin_response_text?.trim()) ||
        Boolean(review?.admin_response_video_url) ||
        Boolean(review?.admin_response_image_urls?.length);

    if (!hasResponse) return null;

    return (
        <div className={`mt-4 rounded-lg border border-blue-500/30 bg-blue-950/30 p-3 ${className}`}>
            <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${titleClassName}`}>
                <MessageSquare className="h-4 w-4" />
                <span>U-Fill Dumpsters Response</span>
            </div>
            {review.admin_response_text && (
                <p className={`whitespace-pre-wrap text-sm ${textClassName}`}>{review.admin_response_text}</p>
            )}
            <ReviewMediaDisplay
                imageUrls={review.admin_response_image_urls}
                videoUrl={review.admin_response_video_url}
                className="mt-3"
                imageClassName="h-20 w-20 rounded-md object-cover border border-blue-300/30"
                videoClassName="w-full max-h-56 rounded-md border border-blue-300/30"
            />
            {review.admin_response_updated_at && (
                <p className="mt-2 text-xs text-blue-200/70">
                    Updated {format(new Date(review.admin_response_updated_at), 'PPP p')}
                </p>
            )}
        </div>
    );
};

