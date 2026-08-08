import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Star, CheckCircle, Trash2, EyeOff, Smile, Upload, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { ReviewMediaDisplay } from '@/components/ReviewMediaDisplay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';
import {
    uploadReviewResponseImage,
    uploadReviewResponseVideo,
    formatReviewUploadError,
    resolveReviewVideoMime,
    MAX_REVIEW_IMAGES,
    REVIEW_IMAGE_TYPES,
    REVIEW_VIDEO_TYPES,
} from '@/utils/reviewMediaHelper';
import { sendReviewApprovedChatMessage, sendReviewResponseChatMessage } from '@/utils/reviewNotificationHelper';
import { ReviewAdminResponse } from '@/components/ReviewAdminResponse';

const StarRating = ({ rating }) => (
    <div className="flex">
        {[...Array(5)].map((_, i) => (
            <Star
                key={i}
                className={`h-5 w-5 ${i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
            />
        ))}
    </div>
);

const ReviewCard = ({ review, onUpdate, onDelete }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSavingResponse, setIsSavingResponse] = useState(false);
    const [responseText, setResponseText] = useState(review.admin_response_text || '');
    const [existingResponseImages, setExistingResponseImages] = useState(review.admin_response_image_urls || []);
    const [existingResponseVideo, setExistingResponseVideo] = useState(review.admin_response_video_url || null);
    const [newResponseImages, setNewResponseImages] = useState([]);
    const [newResponseVideo, setNewResponseVideo] = useState(null);
    const imageInputRef = useRef(null);
    const videoInputRef = useRef(null);

    useEffect(() => {
        setResponseText(review.admin_response_text || '');
        setExistingResponseImages(review.admin_response_image_urls || []);
        setExistingResponseVideo(review.admin_response_video_url || null);
        setNewResponseImages([]);
        setNewResponseVideo(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
        if (videoInputRef.current) videoInputRef.current.value = '';
    }, [
        review.id,
        review.admin_response_text,
        review.admin_response_image_urls,
        review.admin_response_video_url,
        review.admin_response_updated_at,
    ]);

    const handleApprove = async () => {
        setIsUpdating(true);
        const isFirstPublish = !review.is_public;
        try {
            const { error } = await supabase
                .from('reviews')
                .update({ is_public: true })
                .eq('id', review.id);
            if (error) throw error;

            if (isFirstPublish) {
                try {
                    await sendReviewApprovedChatMessage(review);
                } catch (chatError) {
                    console.error('[ReviewsManager] Approval chat notification failed:', chatError);
                    toast({
                        title: 'Review Approved',
                        description:
                            'Review is now public, but the customer was not notified in chat. Please follow up manually.',
                        variant: 'destructive',
                    });
                    onUpdate({ ...review, is_public: true });
                    return;
                }
            }

            toast({
                title: 'Review Approved',
                description: isFirstPublish
                    ? 'Review is now public. The customer has been thanked in chat (if not already notified).'
                    : 'Review is now public.',
            });
            onUpdate({ ...review, is_public: true });
        } catch (error) {
            toast({ title: 'Approval Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleUnpublish = async () => {
        setIsUpdating(true);
        try {
            const { error } = await supabase
                .from('reviews')
                .update({ is_public: false })
                .eq('id', review.id);
            if (error) throw error;
            toast({
                title: 'Review Unpublished',
                description: 'Review removed from the public site. It is now pending approval.',
            });
            onUpdate({ ...review, is_public: false });
        } catch (error) {
            toast({ title: 'Unpublish Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleReject = async () => {
        if (!window.confirm('Are you sure you want to reject and delete this review?')) return;
        setIsDeleting(true);
        try {
            const { error } = await supabase.from('reviews').delete().eq('id', review.id);
            if (error) throw error;
            toast({ title: 'Review Rejected', description: 'Review has been deleted.' });
            onDelete(review.id);
        } catch (error) {
            toast({ title: 'Rejection Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm('Permanently delete this review? This cannot be undone.')) return;
        setIsDeleting(true);
        try {
            const { error } = await supabase.from('reviews').delete().eq('id', review.id);
            if (error) throw error;
            toast({ title: 'Review Deleted', description: 'Review has been permanently removed.' });
            onDelete(review.id);
        } catch (error) {
            toast({ title: 'Deletion Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleResponseEmojiClick = (emojiObject) => {
        setResponseText((prev) => prev + emojiObject.emoji);
    };

    const handleResponseImageSelect = (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        const total = existingResponseImages.length + newResponseImages.length + files.length;
        if (total > MAX_REVIEW_IMAGES) {
            toast({
                title: 'Too many photos',
                description: `You can upload up to ${MAX_REVIEW_IMAGES} photos per response.`,
                variant: 'destructive',
            });
            e.target.value = '';
            return;
        }

        for (const file of files) {
            if (!REVIEW_IMAGE_TYPES.includes(file.type)) {
                toast({
                    title: 'Invalid image',
                    description: 'Photos must be JPEG, PNG, or WebP.',
                    variant: 'destructive',
                });
                e.target.value = '';
                return;
            }
        }

        setNewResponseImages((prev) => [...prev, ...files]);
        e.target.value = '';
    };

    const handleResponseVideoSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!REVIEW_VIDEO_TYPES.includes(resolveReviewVideoMime(file))) {
            toast({
                title: 'Invalid video',
                description: 'Video must be MP4, WebM, or MOV.',
                variant: 'destructive',
            });
            e.target.value = '';
            return;
        }

        setNewResponseVideo(file);
        e.target.value = '';
    };

    const handleSaveResponse = async () => {
        const trimmedResponse = responseText.trim();
        const hasAnyResponse =
            Boolean(trimmedResponse) ||
            existingResponseImages.length > 0 ||
            newResponseImages.length > 0 ||
            Boolean(existingResponseVideo) ||
            Boolean(newResponseVideo);

        if (!hasAnyResponse) {
            toast({
                title: 'Response is empty',
                description: 'Add response text, photos, or video before saving.',
                variant: 'destructive',
            });
            return;
        }

        setIsSavingResponse(true);
        try {
            const uploadedImagePaths = [];
            for (const file of newResponseImages) {
                const path = await uploadReviewResponseImage(review.customer_id, review.id, file);
                uploadedImagePaths.push(path);
            }

            let uploadedVideoPath = null;
            if (newResponseVideo) {
                uploadedVideoPath = await uploadReviewResponseVideo(review.customer_id, review.id, newResponseVideo);
            }

            const allImagePaths = [...existingResponseImages, ...uploadedImagePaths];
            const { data: authData } = await supabase.auth.getUser();
            const payload = {
                admin_response_text: trimmedResponse || null,
                admin_response_image_urls: allImagePaths.length ? allImagePaths : null,
                admin_response_video_url: uploadedVideoPath || existingResponseVideo || null,
                admin_response_updated_at: new Date().toISOString(),
                admin_response_updated_by: authData?.user?.id || null,
            };

            const { error } = await supabase.from('reviews').update(payload).eq('id', review.id);
            if (error) throw error;

            try {
                await sendReviewResponseChatMessage(review);
            } catch (chatError) {
                console.error('[ReviewsManager] Review response chat notification failed:', chatError);
                toast({
                    title: 'Response Saved',
                    description: 'Saved, but customer chat notification failed.',
                    variant: 'destructive',
                });
            }

            const updatedReview = { ...review, ...payload };
            onUpdate(updatedReview);
            setExistingResponseImages(allImagePaths);
            setExistingResponseVideo(payload.admin_response_video_url);
            setNewResponseImages([]);
            setNewResponseVideo(null);
            if (imageInputRef.current) imageInputRef.current.value = '';
            if (videoInputRef.current) videoInputRef.current.value = '';

            toast({
                title: review.admin_response_updated_at ? 'Response Updated' : 'Response Saved',
                description: 'Official U-Fill response has been saved.',
            });
        } catch (error) {
            toast({
                title: 'Failed to save response',
                description: formatReviewUploadError(error),
                variant: 'destructive',
            });
        } finally {
            setIsSavingResponse(false);
        }
    };

    return (
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700 flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <p className="font-bold text-white">{review.customers?.name || 'Unknown Customer'}</p>
                        <p className="text-sm text-gray-400">Booking #{review.booking_id}</p>
                    </div>
                    <div className="text-right">
                        <StarRating rating={review.rating} />
                        <p className="text-xs text-gray-500 mt-1">{format(new Date(review.created_at), 'PPP')}</p>
                    </div>
                </div>
                <h4 className="font-semibold text-yellow-400 mb-1">{review.title || 'No Title'}</h4>
                <p className="text-gray-300 text-sm italic whitespace-pre-wrap">"{review.content}"</p>
                <ReviewMediaDisplay
                    imageUrls={review.image_urls}
                    videoUrl={review.video_url}
                    maxImages={6}
                    className="mt-3"
                    imageClassName="h-24 w-24 rounded-md object-cover border border-gray-600 hover:opacity-80 transition-opacity"
                    videoClassName="w-full max-h-56 rounded-md border border-gray-600"
                />
                <ReviewAdminResponse review={review} className="bg-blue-950/20" textClassName="text-blue-100" />
                <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="mb-2 text-sm font-semibold text-white">Official U-Fill Response</p>
                    <div className="relative">
                        <Textarea
                            value={responseText}
                            onChange={(e) => setResponseText(e.target.value)}
                            placeholder="Write an official response to this review..."
                            className="min-h-[100px] border-white/20 bg-black/30 pr-10 text-white"
                        />
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="absolute right-1 top-1 h-8 w-8 text-gray-400 hover:text-white"
                                >
                                    <Smile className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto border-0 bg-transparent p-0">
                                <EmojiPicker onEmojiClick={handleResponseEmojiClick} theme="dark" />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 text-white hover:bg-white/10"
                            onClick={() => imageInputRef.current?.click()}
                        >
                            <Upload className="mr-2 h-4 w-4" /> Upload Photos
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 text-white hover:bg-white/10"
                            onClick={() => videoInputRef.current?.click()}
                        >
                            <Video className="mr-2 h-4 w-4" /> Add Video
                        </Button>
                        <input
                            ref={imageInputRef}
                            type="file"
                            multiple
                            accept={REVIEW_IMAGE_TYPES.join(',')}
                            className="hidden"
                            onChange={handleResponseImageSelect}
                        />
                        <input
                            ref={videoInputRef}
                            type="file"
                            accept={REVIEW_VIDEO_TYPES.join(',')}
                            className="hidden"
                            onChange={handleResponseVideoSelect}
                        />
                    </div>
                    {(existingResponseImages.length > 0 || existingResponseVideo) && (
                        <div className="mt-3 rounded-md border border-white/10 p-2">
                            <p className="mb-2 text-xs text-gray-400">Current response media</p>
                            <ReviewMediaDisplay
                                imageUrls={existingResponseImages}
                                videoUrl={existingResponseVideo}
                                maxImages={6}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mt-2 h-7 px-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                                onClick={() => {
                                    setExistingResponseImages([]);
                                    setExistingResponseVideo(null);
                                }}
                            >
                                Clear Existing Media
                            </Button>
                        </div>
                    )}
                    {newResponseImages.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {newResponseImages.map((file, index) => (
                                <div key={`${file.name}-${index}`} className="relative">
                                    <img
                                        src={URL.createObjectURL(file)}
                                        alt="Response preview"
                                        className="h-16 w-16 rounded object-cover border border-white/10"
                                    />
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="destructive"
                                        className="absolute -right-2 -top-2 h-5 w-5 rounded-full"
                                        onClick={() => {
                                            setNewResponseImages((prev) => prev.filter((_, i) => i !== index));
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                    {newResponseVideo && (
                        <div className="relative mt-3 max-w-xs">
                            <video
                                src={URL.createObjectURL(newResponseVideo)}
                                controls
                                className="max-h-40 w-full rounded border border-white/10"
                                preload="metadata"
                            />
                            <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                className="absolute -right-2 -top-2 h-5 w-5 rounded-full"
                                onClick={() => {
                                    setNewResponseVideo(null);
                                    if (videoInputRef.current) videoInputRef.current.value = '';
                                }}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                        Up to {MAX_REVIEW_IMAGES} photos (10MB each) and 1 video (50MB).
                    </p>
                    <Button
                        type="button"
                        className="mt-3 w-full bg-blue-600 text-white hover:bg-blue-700"
                        disabled={isSavingResponse}
                        onClick={handleSaveResponse}
                    >
                        {isSavingResponse ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <CheckCircle className="mr-2 h-4 w-4" />
                        )}
                        {review.admin_response_updated_at ? 'Update Response' : 'Save Response'}
                    </Button>
                </div>
            </div>
            <div className="flex flex-wrap justify-end items-center gap-2 mt-4 pt-4 border-t border-gray-700">
                <span
                    className={`text-xs font-bold flex items-center mr-auto ${
                        review.is_public ? 'text-green-400' : 'text-orange-400'
                    }`}
                >
                    {review.is_public ? (
                        <>
                            <CheckCircle className="h-4 w-4 mr-1" /> Public
                        </>
                    ) : (
                        <>
                            <EyeOff className="h-4 w-4 mr-1" /> Pending
                        </>
                    )}
                </span>
                {!review.is_public ? (
                    <>
                        <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={handleApprove}
                            disabled={isUpdating || isDeleting}
                        >
                            {isUpdating ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                                <CheckCircle className="h-4 w-4 mr-1" />
                            )}{' '}
                            Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleReject}
                            disabled={isUpdating || isDeleting}
                        >
                            {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                                <Trash2 className="h-4 w-4 mr-1" />
                            )}{' '}
                            Reject
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            size="sm"
                            variant="outline"
                            className="border-white/20 text-white hover:bg-white/10"
                            onClick={handleUnpublish}
                            disabled={isUpdating || isDeleting}
                        >
                            {isUpdating ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                                <EyeOff className="h-4 w-4 mr-1" />
                            )}{' '}
                            Unpublish
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isUpdating || isDeleting}
                        >
                            {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                                <Trash2 className="h-4 w-4 mr-1" />
                            )}{' '}
                            Delete
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};

export const ReviewsManager = () => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('private');

    const fetchReviews = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('reviews')
            .select('*, customers(name)')
            .order('created_at', { ascending: false });

        if (filter === 'public') {
            query = query.eq('is_public', true);
        } else if (filter === 'private') {
            query = query.eq('is_public', false);
        }

        const { data, error } = await query;

        if (error) {
            toast({ title: 'Error fetching reviews', description: error.message, variant: 'destructive' });
        } else {
            setReviews(data || []);
        }
        setLoading(false);
    }, [filter]);

    useEffect(() => {
        fetchReviews();
    }, [fetchReviews]);

    const handleUpdateReview = (updatedReview) => {
        setReviews((prev) => prev.map((r) => (r.id === updatedReview.id ? updatedReview : r)));
        if (filter !== 'all') {
            fetchReviews();
        }
    };

    const handleDeleteReview = (deletedId) => {
        setReviews((prev) => prev.filter((r) => r.id !== deletedId));
    };

    return (
        <div className="bg-gray-900/50 p-6 rounded-lg">
            <h2 className="text-2xl font-bold text-white mb-4">Manage Customer Reviews</h2>
            <div className="flex gap-2 mb-6">
                <Button variant={filter === 'private' ? 'default' : 'outline'} onClick={() => setFilter('private')}>
                    Pending Approval
                </Button>
                <Button variant={filter === 'public' ? 'default' : 'outline'} onClick={() => setFilter('public')}>
                    Public
                </Button>
                <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
                    All
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-16">
                    <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
                </div>
            ) : reviews.length === 0 ? (
                <div className="text-center bg-black/20 rounded-lg p-12 border border-white/5">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4 opacity-50" />
                    <p className="text-gray-400">No reviews found for this filter.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {reviews.map((review) => (
                        <ReviewCard
                            key={review.id}
                            review={review}
                            onUpdate={handleUpdateReview}
                            onDelete={handleDeleteReview}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
