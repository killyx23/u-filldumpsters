
import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Label } from '@/components/ui/label';

const ContactPage = () => {
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        const { data: customerData, error: customerError } = await supabase
            .from('customers')
            .select('id')
            .eq('email', email)
            .single();

        if (customerError && customerError.code !== 'PGRST116') { // Ignore "no rows found"
            toast({ variant: "destructive", title: "An error occurred." });
            setIsLoading(false);
            return;
        }

        const { error: messageError } = await supabase
            .from('customer_notes')
            .insert([{ 
                customer_id: customerData?.id, // Can be null if customer not found
                source: 'Contact Form',
                content: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
             }]);

        setIsLoading(false);

        if (messageError) {
            toast({
                variant: "destructive",
                title: "Uh oh! Something went wrong.",
                description: "There was a problem sending your message. Please try again.",
            });
        } else {
            toast({
                title: "Message Sent!",
                description: "Thanks for reaching out. We'll get back to you soon.",
            });
            setName('');
            setEmail('');
            setMessage('');
        }
    };

    return (
        <>
            <Helmet>
                <title>Contact Us - U-Fill Dumpsters</title>
                <meta name="description" content="Get in touch with U-Fill Dumpsters for any questions about our services, bookings, or support. We're here to help." />
            </Helmet>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="container mx-auto max-w-2xl py-16 px-4"
            >
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl">
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-bold text-yellow-400 mb-2">Contact Us</h1>
                        <p className="text-lg text-blue-200">Have a question? We'd love to hear from you.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <Label htmlFor="name" className="text-white">Full Name</Label>
                            <Input
                                id="name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="John Doe"
                                required
                                className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                            />
                        </div>
                        <div>
                            <Label htmlFor="email" className="text-white">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                                className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                            />
                        </div>
                        <div>
                            <Label htmlFor="message" className="text-white">Message</Label>
                            <Textarea
                                id="message"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="How can we help you today?"
                                required
                                rows={6}
                                className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-3 text-lg"
                        >
                            {isLoading ? 'Sending...' : 'Send Message'}
                        </Button>
                    </form>
                </div>
            </motion.div>
        </>
    );
};

export default ContactPage;
