import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Star, Loader2, MessageCircle, Package } from 'lucide-react';
import { Helmet } from 'react-helmet';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

const ReviewCard = ({ review, index, onReadMore }) => {
    const isDeliveryTrailer = review.bookings?.plan?.id === 2 && review.bookings?.addons?.isDelivery;
    const serviceName = isDeliveryTrailer ? 'Dump Loader Trailer Rental Service with Delivery' : review.bookings?.plan?.name || 'Service';
    const isLongReview = review.content.length > 150;

    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 flex flex-col h-full"
        >
            <div className="flex items-center text-yellow-400 text-sm font-semibold mb-3">
                <Package className="h-4 w-4 mr-2" />
                <span>{serviceName}</span>
            </div>
            <div className="flex items-center justify-between mb-3">
                <StarRating rating={review.rating} />
                <p className="text-sm text-blue-200">{new Date(review.created_at).toLocaleDateString()}</p>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 truncate">{review.title || 'A Great Experience'}</h3>
            <p className="text-blue-100 text-base flex-grow mb-4 line-clamp-4">"{review.content}"</p>
            <div className="flex justify-between items-end mt-auto pt-4">
                 <p className="font-semibold text-white">- {review.customers.name}</p>
                {isLongReview && (
                    <Button variant="link" size="sm" className="p-0 h-auto text-yellow-400" onClick={() => onReadMore(review)}>
                        Read More
                    </Button>
                )}
            </div>
        </motion.div>
    );
};

export default function ReviewsPage() {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedReview, setSelectedReview] = useState(null);

    useEffect(() => {
        const fetchReviews = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('reviews')
                .select('*, customers(name), bookings(plan, addons)')
                .eq('is_public', true)
                .order('created_at', { ascending: false });

            if (error) {
                setError(error.message);
                console.error("Error fetching reviews:", error);
            } else {
                setReviews(data);
            }
            setLoading(false);
        };
        fetchReviews();
    }, []);

    const averageRating = reviews.length > 0
        ? (reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length).toFixed(1)
        : 0;

    return (
        <>
            <Helmet>
                <title>Customer Reviews - U-Fill Dumpsters</title>
                <meta name="description" content="Read honest reviews from our satisfied customers. See why we're the top choice for dumpster and trailer rentals." />
            </Helmet>
            <div className="container mx-auto py-16 px-4 relative">
                <BackButton className="absolute top-4 left-4 z-20" />
                <div className="text-center mb-12 pt-8 md:pt-0">
                    <motion.h1
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-4xl sm:text-5xl font-bold text-white mb-4 flex items-center justify-center"
                    >
                        <MessageCircle className="h-10 w-10 mr-4 text-yellow-400" />
                        Customer Reviews
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-lg text-blue-200 max-w-2xl mx-auto"
                    >
                        See what real customers are saying about their experience with U-Fill Dumpsters.
                    </motion.p>
                </div>

                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
                    </div>
                ) : error ? (
                    <div className="text-center text-red-400 bg-red-900/50 p-4 rounded-lg">
                        <p>Could not load reviews at this time. Please try again later.</p>
                    </div>
                ) : reviews.length > 0 ? (
                    <>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.3 }}
                            className="mb-12 bg-white/5 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-center gap-4 text-center"
                        >
                            <p className="text-2xl font-bold text-white">Overall Rating:</p>
                            <div className="flex items-center gap-3">
                                <p className="text-5xl font-extrabold text-yellow-400">{averageRating}</p>
                                <div className="flex flex-col items-start">
                                    <StarRating rating={Math.round(averageRating)} />
                                    <p className="text-blue-200">Based on {reviews.length} reviews</p>
                                </div>
                            </div>
                        </motion.div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {reviews.map((review, index) => (
                                <ReviewCard key={review.id} review={review} index={index} onReadMore={setSelectedReview} />
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="text-center text-blue-200 py-16">
                        <p className="text-xl">No public reviews yet. Be the first!</p>
                    </div>
                )}
            </div>
            {selectedReview && (
                <Dialog open={!!selectedReview} onOpenChange={() => setSelectedReview(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{selectedReview.title || 'A Great Experience'}</DialogTitle>
                            <DialogDescription className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <StarRating rating={selectedReview.rating} />
                                    <span className="text-sm">by {selectedReview.customers.name}</span>
                                </div>
                                <div className="flex items-center text-yellow-400 text-sm font-semibold">
                                    <Package className="h-4 w-4 mr-2" />
                                    <span>{selectedReview.bookings?.plan?.id === 2 && selectedReview.bookings?.addons?.isDelivery ? 'Dump Loader Trailer Rental Service with Delivery' : selectedReview.bookings?.plan?.name || 'Service'}</span>
                                </div>
                            </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="max-h-[60vh] pr-4">
                            <p className="text-blue-100 whitespace-pre-wrap">{selectedReview.content}</p>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}