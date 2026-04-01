
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Star, MessageSquare, Ticket, Send, Paperclip, Loader2, Smile, FileText, X } from 'lucide-react';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker from 'emoji-picker-react';

export const CommunicationHub = ({ customer, bookings, notes, onNewNote, onRefreshData }) => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white mb-1">Communication Hub</h2>
                <p className="text-sm text-blue-200">Chat with support, submit tickets, or leave reviews.</p>
            </div>

            <Tabs defaultValue="chat" className="w-full">
                <TabsList className="grid w-full grid-cols-3 bg-black/20 text-white">
                    <TabsTrigger value="chat"><MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Direct Chat</TabsTrigger>
                    <TabsTrigger value="tickets"><Ticket className="w-4 h-4 mr-2 hidden sm:block"/> Support Tickets</TabsTrigger>
                    <TabsTrigger value="reviews"><Star className="w-4 h-4 mr-2 hidden sm:block"/> Feedback</TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="mt-4">
                    <ChatInterface customer={customer} notes={notes} onNewNote={onNewNote} />
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

const ChatInterface = ({ customer, notes, onNewNote }) => {
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef(null);
    const fileInputRef = useRef(null);

    // Filter notes for standard chat (exclude system logs if needed, but keeping simple for now)
    const chatNotes = notes.filter(n => n.source !== 'Support Ticket');

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatNotes]);

    const handleSendMessage = async (attachment = null) => {
        if (!message.trim() && !attachment) return;
        setIsSending(true);

        const notePayload = {
            customer_id: customer.id,
            content: message.trim(),
            source: 'Customer Portal Chat',
            author_type: 'customer',
            is_read: false,
            attachment_url: attachment?.url || null,
            attachment_name: attachment?.name || null,
        };

        const { data, error } = await supabase.from('customer_notes').insert(notePayload).select().single();

        if (error) {
            toast({ title: 'Failed to send message', description: error.message, variant: 'destructive' });
        } else {
            onNewNote(data);
            setMessage('');
        }
        setIsSending(false);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsSending(true);
        const filePath = `chat-attachments/${customer.id}/${Date.now()}-${file.name}`;
        
        try {
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            await handleSendMessage({ url: data.publicUrl, name: file.name });
        } catch (error) {
            toast({ title: "Attachment Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSending(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const ChatBubble = ({ note }) => {
        const isAdmin = note.author_type === 'admin';
        return (
            <div className={`flex flex-col gap-1 w-full my-2 ${isAdmin ? 'items-start' : 'items-end'}`}>
                <div className={`p-3 max-w-[85%] sm:max-w-[70%] rounded-2xl ${isAdmin ? 'bg-gray-700 text-white rounded-bl-sm' : 'bg-blue-600 text-white rounded-br-sm'}`}>
                    <p className="text-xs font-semibold opacity-70 mb-1">{isAdmin ? 'Support Team' : 'You'}</p>
                    {note.content && <p className="text-sm whitespace-pre-wrap">{note.content}</p>}
                    {note.attachment_url && (
                        <a href={note.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 block bg-black/20 p-2 rounded flex items-center gap-2 hover:bg-black/40">
                            <FileText className="h-4 w-4" /> <span className="text-xs truncate">{note.attachment_name || 'Attachment'}</span>
                        </a>
                    )}
                </div>
                <p className="text-[10px] text-gray-500 px-1">{format(parseISO(note.created_at), 'MMM d, h:mm a')}</p>
            </div>
        );
    };

    return (
        <Card className="bg-gray-800 border-white/10 flex flex-col h-[600px]">
            <CardHeader className="py-3 border-b border-white/10 bg-gray-900/50">
                <CardTitle className="text-lg flex items-center"><MessageSquare className="w-5 h-5 mr-2 text-blue-400"/> Live Support</CardTitle>
                <CardDescription>Usually replies within a few hours.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 flex flex-col gap-2" ref={chatContainerRef}>
                {chatNotes.length === 0 ? (
                    <div className="m-auto text-center text-gray-500">
                        <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-20" />
                        <p>No messages yet. Start a conversation!</p>
                    </div>
                ) : (
                    chatNotes.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)).map(note => <ChatBubble key={note.id} note={note} />)
                )}
            </CardContent>
            <div className="p-3 bg-gray-900 border-t border-white/10 mt-auto">
                <div className="relative">
                    <Textarea 
                        value={message} onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                        placeholder="Type your message..." className="bg-gray-800 border-gray-700 pr-24 resize-none h-[60px]"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-white">
                            <Paperclip className="h-5 w-5" />
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                        <Button size="icon" onClick={() => handleSendMessage()} disabled={isSending || (!message.trim())} className="bg-blue-600 hover:bg-blue-700">
                            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
};

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
                            <label className="text-sm font-medium mb-1 block">Subject</label>
                            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required className="bg-black/30 border-white/20" placeholder="E.g., Damage Claim" />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Description</label>
                            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required className="bg-black/30 border-white/20 h-32" placeholder="Provide details..." />
                        </div>
                        <Button type="submit" disabled={isSubmitting || !subject || !description} className="w-full bg-blue-600 hover:bg-blue-700">
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
    // Requires logic to find unreviewed completed bookings
    const completedBookings = bookings.filter(b => ['Completed', 'flagged'].includes(b.status));
    // Check if b.reviews exists to filter out already reviewed. If not nested, we can just show all completed and allow re-review or handle logic via parent prop
    
    // Using a simplified version for UI purpose
    return (
        <Card className="bg-white/5 border-white/10 text-white">
            <CardHeader>
                <CardTitle className="text-lg">Service Feedback</CardTitle>
                <CardDescription>Your reviews help us improve.</CardDescription>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-gray-300 mb-6">
                    To leave a review for a completed service, navigate to the <strong>Bookings</strong> tab, and click on a completed booking to submit your feedback.
                </p>
                <div className="bg-black/20 p-6 rounded-lg border border-white/10 text-center">
                    <Star className="w-12 h-12 text-yellow-400 mx-auto mb-4 opacity-50" />
                    <h4 className="font-bold text-lg">Thank you for choosing U-Fill Dumpsters!</h4>
                </div>
            </CardContent>
        </Card>
    );
};
