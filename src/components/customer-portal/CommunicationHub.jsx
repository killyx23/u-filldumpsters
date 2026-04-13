
import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Star, MessageSquare, Ticket, Send, Paperclip, Loader2, CheckCircle, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useRealTimeChat } from '@/hooks/useRealTimeChat';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';

export const CommunicationHub = ({ customer, bookings, notes, onNewNote, onRefreshData }) => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white mb-1">Communication Hub</h2>
                <p className="text-sm text-blue-200">Chat with support in real-time, submit tickets, or leave reviews.</p>
            </div>

            <Tabs defaultValue="chat" className="w-full">
                <TabsList className="grid w-full grid-cols-3 bg-black/20 text-white">
                    <TabsTrigger value="chat"><MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Direct Chat</TabsTrigger>
                    <TabsTrigger value="tickets"><Ticket className="w-4 h-4 mr-2 hidden sm:block"/> Support Tickets</TabsTrigger>
                    <TabsTrigger value="reviews"><Star className="w-4 h-4 mr-2 hidden sm:block"/> Feedback</TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="mt-4">
                    <ChatInterface customer={customer} />
                </TabsContent>

                <TabsContent value="tickets" className="mt-4">
                    <SupportTickets customer={customer} notes={notes} onNewNote={onNewNote} />
                </TabsContent>

                <TabsContent value="reviews" className="mt-4">
                    <ReviewsSection customer={customer} bookings={bookings} onRefreshData={onRefreshData} />
                </TabsContent>
            </Tabs>
        </div>
    );
};

const ChatInterface = ({ customer }) => {
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);

    const { messages, sendMessage, markAsRead, isLoading, isConnected } = useRealTimeChat(customer.id);
    const { isOtherUserTyping, setIsTyping, typingIndicatorText } = useTypingIndicator(customer.id, 'customer');

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages, isOtherUserTyping]);

    useEffect(() => {
        const unreadIds = messages.filter(m => m.sender_type === 'admin' && !m.is_read).map(m => m.id);
        if (unreadIds.length > 0) {
            markAsRead(unreadIds);
        }
    }, [messages, markAsRead]);

    const handleSend = async (attachment = null) => {
        if (!input.trim() && !attachment) return;
        try {
            await sendMessage(input.trim(), 'customer', attachment);
            setInput('');
        } catch (error) {
            toast({ title: 'Send Failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;
        
        try {
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            await handleSend({ url: data.publicUrl, name: file.name });
        } catch (error) {
            toast({ title: "Attachment Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <Card className="bg-gray-800 border-white/10 flex flex-col h-[600px] shadow-2xl">
            <CardHeader className="py-3 border-b border-white/10 bg-gray-900/50 flex flex-row justify-between items-center">
                <div>
                    <CardTitle className="text-lg flex items-center text-white"><MessageSquare className="w-5 h-5 mr-2 text-blue-400"/> Live Support</CardTitle>
                    <CardDescription className="text-gray-400">We usually reply instantly during business hours.</CardDescription>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-black/30 px-2 py-1 rounded-full border border-white/5">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                    {isConnected ? 'Connected' : 'Reconnecting...'}
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 flex flex-col chat-scroll-container" ref={chatContainerRef}>
                {isLoading && messages.length === 0 ? (
                    <div className="m-auto text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-2" />
                        <p className="text-gray-400 text-sm">Connecting to chat...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="m-auto text-center text-gray-500">
                        <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-20" />
                        <p>No messages yet. Start a conversation!</p>
                    </div>
                ) : (
                    <>
                        {messages.map(msg => (
                            <MessageBubble 
                                key={msg.id} 
                                message={msg} 
                                isCurrentUser={msg.sender_type === 'customer'} 
                                senderName="Support Team" 
                            />
                        ))}
                        <TypingIndicator isTyping={isOtherUserTyping} text={typingIndicatorText} />
                    </>
                )}
            </CardContent>
            <div className="p-3 bg-gray-900 border-t border-white/10 mt-auto rounded-b-lg">
                <div className="relative flex items-center">
                    <Textarea 
                        value={input} 
                        onChange={(e) => { setInput(e.target.value); setIsTyping(); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Type your message... (Shift+Enter for new line)" 
                        className="bg-gray-800 border-gray-700 pr-24 resize-none h-[50px] min-h-[50px] max-h-[120px] text-white focus-visible:ring-blue-500"
                        onInput={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                    />
                    <div className="absolute right-2 flex items-center gap-1 bg-gray-800 px-1 rounded">
                        <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-white h-8 w-8" disabled={isUploading}>
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                        <Button size="icon" onClick={() => handleSend()} disabled={isUploading || !input.trim()} className="bg-blue-600 hover:bg-blue-700 h-8 w-8 text-white">
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
};

// ... (SupportTickets and ReviewsSection components remain exactly the same as in previous implementation, just preserving them to avoid incomplete file issues)

const SupportTickets = ({ customer, notes, onNewNote }) => {
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const ticketNotes = notes.filter(n => n.source === 'Support Ticket').sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const payload = {
            customer_id: customer.id,
            source: 'Support Ticket',
            content: `**TICKET:** ${subject}\n\n${description}`,
            author_type: 'customer'
        };

        const { data, error } = await supabase.from('customer_notes').insert(payload).select().single();
        if (error) {
            toast({ title: 'Failed to create ticket', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Ticket created', description: 'Support will review this shortly.' });
            onNewNote(data);
            setSubject('');
            setDescription('');
        }
        setIsSubmitting(false);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-lg">Submit New Ticket</CardTitle>
                    <CardDescription>For complex issues or claims.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block text-gray-300">Subject</label>
                            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required className="bg-black/30 border-white/20 text-white" placeholder="E.g., Damage Claim" />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block text-gray-300">Description</label>
                            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required className="bg-black/30 border-white/20 h-32 text-white" placeholder="Provide details..." />
                        </div>
                        <Button type="submit" disabled={isSubmitting || !subject || !description} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Ticket className="w-4 h-4 mr-2" />} Create Ticket
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <div className="space-y-4 overflow-y-auto max-h-[600px] pr-2">
                <h3 className="font-bold text-lg text-white sticky top-0 bg-gray-900 py-2 z-10">Recent Tickets</h3>
                {ticketNotes.length === 0 ? (
                    <p className="text-gray-400 text-sm">No support tickets history.</p>
                ) : (
                    ticketNotes.map(ticket => (
                        <Card key={ticket.id} className="bg-black/20 border-white/10 text-white">
                            <CardContent className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Pending Review</span>
                                    <span className="text-xs text-gray-500">{format(parseISO(ticket.created_at), 'PPP')}</span>
                                </div>
                                <p className="text-sm whitespace-pre-wrap mt-2 text-gray-300">{ticket.content}</p>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
};

const ReviewsSection = ({ customer, bookings, onRefreshData }) => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedBooking, setSelectedBooking] = useState(null);
    const [rating, setRating] = useState(5);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchReviews = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase
                .from('reviews')
                .select('*')
                .eq('customer_id', customer.id)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            setReviews(data || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReviews();
    }, [customer.id]);

    const completedBookings = bookings?.filter(b => ['Completed', 'flagged', 'Returned'].includes(b.status) || b.returned_at) || [];
    const reviewedBookingIds = reviews.map(r => r.booking_id);
    const unreviewedBookings = completedBookings.filter(b => !reviewedBookingIds.includes(b.id));

    const handleSubmitReview = async (e) => {
        e.preventDefault();
        if (!selectedBooking) return;
        setIsSubmitting(true);

        try {
            const { error } = await supabase.from('reviews').insert({
                booking_id: selectedBooking.id,
                customer_id: customer.id,
                rating,
                title,
                content,
                is_public: false
            });

            if (error) throw error;

            toast({ title: 'Review submitted', description: 'Review submitted and pending admin approval. Thank you for your feedback!' });
            setRating(5);
            setTitle('');
            setContent('');
            setSelectedBooking(null);
            fetchReviews();
            if (onRefreshData) onRefreshData();
        } catch (err) {
            toast({ title: 'Failed to submit review', description: err.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-lg">Leave a Review</CardTitle>
                    <CardDescription>Select a completed booking to review.</CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="bg-red-900/30 text-red-400 p-3 rounded mb-4 text-sm flex justify-between items-center">
                            <span>Error loading reviews: {error}</span>
                            <Button size="sm" variant="outline" onClick={fetchReviews} className="border-red-500/50 hover:bg-red-900/50 text-red-300">Retry</Button>
                        </div>
                    )}
                    
                    {!selectedBooking ? (
                        <div>
                            {unreviewedBookings.length === 0 ? (
                                <div className="text-center p-6 bg-black/20 rounded-lg border border-white/5">
                                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2 opacity-50" />
                                    <p className="text-gray-400">You have no pending reviews. Complete a booking to leave feedback!</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {unreviewedBookings.map(booking => (
                                        <div key={booking.id} className="bg-black/20 border border-white/10 p-3 rounded-lg flex justify-between items-center hover:bg-white/5 transition-colors">
                                            <div>
                                                <p className="font-semibold text-sm">Booking #{booking.id}</p>
                                                <p className="text-xs text-gray-400">{booking.plan?.name || 'Service'} • {format(parseISO(booking.drop_off_date), 'MMM d, yyyy')}</p>
                                            </div>
                                            <Button size="sm" onClick={() => setSelectedBooking(booking)} className="bg-white text-black hover:bg-gray-200">Review</Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <form onSubmit={handleSubmitReview} className="space-y-4">
                            <div className="bg-black/20 p-3 rounded border border-white/10 mb-4 flex justify-between items-center text-sm">
                                <span>Reviewing Booking <strong>#{selectedBooking.id}</strong></span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedBooking(null)} className="h-6 px-2 text-gray-400 hover:text-white">Cancel</Button>
                            </div>
                            
                            <div>
                                <label className="text-sm font-medium mb-2 block text-gray-300">Rating</label>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(star => (
                                        <button 
                                            key={star} type="button" 
                                            onClick={() => setRating(star)}
                                            className="focus:outline-none transition-transform hover:scale-110 active:scale-95"
                                        >
                                            <Star className={`w-8 h-8 ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block text-gray-300">Title</label>
                                <Input value={title} onChange={(e) => setTitle(e.target.value)} required className="bg-black/30 border-white/20 text-white" placeholder="Summary of your experience" />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block text-gray-300">Review</label>
                                <Textarea value={content} onChange={(e) => setContent(e.target.value)} required className="bg-black/30 border-white/20 h-32 text-white" placeholder="Tell us what you thought..." />
                            </div>
                            <Button type="submit" disabled={isSubmitting || !title || !content} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold">
                                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Star className="w-4 h-4 mr-2" />} Submit Review
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>

            <div className="space-y-4 overflow-y-auto max-h-[600px] pr-2">
                <h3 className="font-bold text-lg text-white sticky top-0 bg-gray-900 py-2 z-10">Your Reviews</h3>
                {reviews.length === 0 ? (
                    <p className="text-gray-400 text-sm">You haven't submitted any reviews yet.</p>
                ) : (
                    reviews.map(review => (
                        <Card key={review.id} className="bg-black/20 border-white/10 text-white">
                            <CardContent className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex gap-1">
                                        {[...Array(5)].map((_, i) => (
                                            <Star key={i} className={`w-4 h-4 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                                        ))}
                                    </div>
                                    {review.is_public ? (
                                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded flex items-center border border-green-500/30"><CheckCircle className="w-3 h-3 mr-1"/> Published</span>
                                    ) : (
                                        <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded flex items-center border border-orange-500/30"><Clock className="w-3 h-3 mr-1"/> Pending</span>
                                    )}
                                </div>
                                <h4 className="font-bold text-sm mb-1 text-white">{review.title}</h4>
                                <p className="text-sm whitespace-pre-wrap mt-2 text-gray-300">{review.content}</p>
                                <p className="text-xs text-gray-500 mt-3">{format(parseISO(review.created_at), 'PPP')}</p>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
};
