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

    const handleTogglePublic = async () => {
        setIsUpdating(true);
        try {
            const { error } = await supabase
                .from('reviews')
                .update({ is_public: !review.is_public })
                .eq('id', review.id);
            if (error) throw error;
            toast({ title: `Review is now ${!review.is_public ? 'public' : 'private'}.` });
            onUpdate({ ...review, is_public: !review.is_public });
        } catch (error) {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("Are you sure you want to permanently delete this review?")) return;
        setIsDeleting(true);
        try {
            const { error } = await supabase.from('reviews').delete().eq('id', review.id);
            if (error) throw error;
            toast({ title: "Review Deleted" });
            onDelete(review.id);
        } catch (error) {
            toast({ title: "Deletion Failed", description: error.message, variant: "destructive" });
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
                <p className="text-gray-300 text-sm italic">"{review.content}"</p>
            </div>
            <div className="flex justify-end items-center gap-2 mt-4 pt-4 border-t border-gray-700">
                <span className={`text-xs font-bold flex items-center ${review.is_public ? 'text-green-400' : 'text-orange-400'}`}>
                    {review.is_public ? <CheckCircle className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
                    {review.is_public ? 'Public' : 'Private'}
                </span>
                <Button size="sm" variant="ghost" onClick={handleTogglePublic} disabled={isUpdating || isDeleting}>
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : (review.is_public ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />)}
                </Button>
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={isUpdating || isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
            </div>
        </div>
    );
};

export const ReviewsManager = () => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // 'all', 'public', 'private'

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
            setReviews(data);
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
                <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All</Button>
                <Button variant={filter === 'private' ? 'default' : 'outline'} onClick={() => setFilter('private')}>Pending Approval</Button>
                <Button variant={filter === 'public' ? 'default' : 'outline'} onClick={() => setFilter('public')}>Public</Button>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-16">
                    <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
                </div>
            ) : reviews.length === 0 ? (
                <p className="text-center text-gray-400 py-16">No reviews found for this filter.</p>
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