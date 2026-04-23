import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Star, MessageCircle, ChevronLeft, ChevronRight, Package, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
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

const ReviewCard = ({ review, onReadMore }) => {
    // Safely access nested properties to prevent crashes
    const isDeliveryTrailer = review.bookings?.plan?.id === 2 && review.bookings?.addons?.isDelivery;
    const serviceName = review.bookings?.plan?.name ? (isDeliveryTrailer ? 'Dump Loader Trailer Rental Service with Delivery' : review.bookings.plan.name) : 'Service';
    const isLongReview = review.content.length > 120;
    const customerName = review.customers?.name || 'Valued Customer';

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.5 }}
            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 flex flex-col h-full min-h-[250px]"
        >
            <div className="flex items-center text-yellow-400 text-sm font-semibold mb-3">
                <Package className="h-4 w-4 mr-2" />
                <span>{serviceName}</span>
            </div>
            <div className="flex items-center justify-between mb-3">
                <StarRating rating={review.rating} />
                <p className="text-sm text-blue-200">{new Date(review.created_at).toLocaleDateString()}</p>
            </div>
            <h4 className="text-lg font-bold text-white mb-2 truncate">{review.title || 'Great Service!'}</h4>
            <p className="text-blue-100 text-sm flex-grow line-clamp-3">"{review.content}"</p>
            <div className="flex justify-between items-end mt-4">
                <p className="text-right font-semibold text-white">- {customerName}</p>
                {isLongReview && (
                    <Button variant="link" size="sm" className="p-0 h-auto text-yellow-400" onClick={() => onReadMore(review)}>
                        Read More
                    </Button>
                )}
            </div>
        </motion.div>
    );
};

export const ReviewsCarousel = () => {
    const [reviews, setReviews] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectedReview, setSelectedReview] = useState(null);

    useEffect(() => {
        const fetchReviews = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('reviews')
                .select('*, customers(name), bookings(plan, addons)')
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) {
                console.error("Error fetching reviews:", error);
            } else {
                setReviews(data);
            }
            setLoading(false);
        };
        fetchReviews();
    }, []);

    useEffect(() => {
        if (reviews.length > 1) {
            const timer = setInterval(() => {
                setCurrentIndex((prevIndex) => (prevIndex + 1) % reviews.length);
            }, 5000);
            return () => clearInterval(timer);
        }
    }, [reviews.length]);

    const handlePrev = () => {
        setCurrentIndex((prevIndex) => (prevIndex - 1 + reviews.length) % reviews.length);
    };

    const handleNext = () => {
        setCurrentIndex((prevIndex) => (prevIndex + 1) % reviews.length);
    };

    if (loading) {
        return null; // Don't show anything while loading
    }

    if (reviews.length === 0) {
        return null; // Don't render the section if there are no reviews
    }

    return (
        <section className="py-16 sm:py-24">
            <div className="container mx-auto px-4">
                <div className="text-center mb-12">
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 flex items-center justify-center">
                        <MessageCircle className="h-8 w-8 mr-3 text-yellow-400" />
                        What Our Customers Say
                    </h2>
                    <p className="text-lg text-blue-200 max-w-2xl mx-auto">
                        Honest feedback from real customers who have used our services.
                    </p>
                </div>

                <div className="relative max-w-4xl mx-auto">
                    <AnimatePresence mode="wait">
                        <div key={currentIndex} className="px-12">
                            <ReviewCard review={reviews[currentIndex]} onReadMore={setSelectedReview} />
                        </div>
                    </AnimatePresence>

                    {reviews.length > 1 && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full h-12 w-12 hover:bg-white/20"
                                onClick={handlePrev}
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full h-12 w-12 hover:bg-white/20"
                                onClick={handleNext}
                            >
                                <ChevronRight className="h-6 w-6" />
                            </Button>
                        </>
                    )}
                </div>
                <div className="text-center mt-12">
                    <Button asChild size="lg" className="bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black">
                        <Link to="/reviews">Read All Reviews</Link>
                    </Button>
                </div>
            </div>
            
            {selectedReview && (
                <Dialog open={!!selectedReview} onOpenChange={() => setSelectedReview(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{selectedReview.title || 'A Great Experience'}</DialogTitle>
                            <DialogDescription className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <StarRating rating={selectedReview.rating} />
                                    <span className="text-sm">by {selectedReview.customers?.name || 'Valued Customer'}</span>
                                </div>
                                <div className="flex items-center text-yellow-400 text-sm font-semibold">
                                    <Package className="h-4 w-4 mr-2" />
                                    <span>{selectedReview.bookings?.plan?.name ? (selectedReview.bookings?.plan?.id === 2 && selectedReview.bookings?.addons?.isDelivery ? 'Dump Loader Trailer Rental Service with Delivery' : selectedReview.bookings?.plan?.name) : 'Service'}</span>
                                </div>
                            </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="max-h-[60vh] pr-4">
                            <p className="text-blue-100 whitespace-pre-wrap">{selectedReview.content}</p>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            )}
        </section>
    );
};