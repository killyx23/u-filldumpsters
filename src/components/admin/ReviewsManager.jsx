import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Star, CheckCircle, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

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

    const handleApprove = async () => {
        setIsUpdating(true);
        try {
            const { error } = await supabase
                .from('reviews')
                .update({ is_public: true })
                .eq('id', review.id);
            if (error) throw error;
            toast({ title: 'Review Approved', description: 'Review is now public.' });
            onUpdate({ ...review, is_public: true });
        } catch (error) {
            toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleReject = async () => {
        if (!window.confirm("Are you sure you want to reject and delete this review?")) return;
        setIsDeleting(true);
        try {
            const { error } = await supabase.from('reviews').delete().eq('id', review.id);
            if (error) throw error;
            toast({ title: "Review Rejected", description: 'Review has been deleted.' });
            onDelete(review.id);
        } catch (error) {
            toast({ title: "Rejection Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsDeleting(false);
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
            </div>
            <div className="flex justify-end items-center gap-2 mt-4 pt-4 border-t border-gray-700">
                {!review.is_public ? (
                    <>
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={isUpdating || isDeleting}>
                            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />} Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleReject} disabled={isUpdating || isDeleting}>
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} Reject
                        </Button>
                    </>
                ) : (
                    <span className="text-xs font-bold flex items-center text-green-400 mr-auto">
                        <CheckCircle className="h-4 w-4 mr-1" /> Public
                    </span>
                )}
                 {review.is_public && (
                     <Button size="sm" variant="destructive" onClick={handleReject} disabled={isDeleting}>
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} Delete
                     </Button>
                 )}
            </div>
        </div>
    );
};

export const ReviewsManager = () => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('private'); // Default to pending approval

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
            toast({ title: "Error fetching reviews", description: error.message, variant: "destructive" });
        } else {
            setReviews(data || []);
        }
        setLoading(false);
    }, [filter]);

    useEffect(() => {
        fetchReviews();
    }, [fetchReviews]);

    const handleUpdateReview = (updatedReview) => {
        setReviews(prev => prev.map(r => r.id === updatedReview.id ? updatedReview : r));
        if (filter !== 'all') {
            fetchReviews();
        }
    };

    const handleDeleteReview = (deletedId) => {
        setReviews(prev => prev.filter(r => r.id !== deletedId));
    };

    return (
        <div className="bg-gray-900/50 p-6 rounded-lg">
            <h2 className="text-2xl font-bold text-white mb-4">Manage Customer Reviews</h2>
            <div className="flex gap-2 mb-6">
                <Button variant={filter === 'private' ? 'default' : 'outline'} onClick={() => setFilter('private')}>Pending Approval</Button>
                <Button variant={filter === 'public' ? 'default' : 'outline'} onClick={() => setFilter('public')}>Public</Button>
                <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All</Button>
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
                    {reviews.map(review => (
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