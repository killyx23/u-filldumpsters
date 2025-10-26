import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const FaqItem = ({ q, a, isOpen, onClick }) => {
  return (
    <div className="border-b border-white/20 py-4">
      <button
        onClick={onClick}
        className="w-full flex justify-between items-center text-left"
      >
        <h3 className="text-lg font-semibold text-white">{q}</h3>
        {isOpen ? <ChevronUp className="text-yellow-400" /> : <ChevronDown className="text-yellow-400" />}
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0, marginTop: isOpen ? '1rem' : 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden"
      >
        <p className="text-blue-200 whitespace-pre-wrap">{a}</p>
      </motion.div>
    </div>
  );
};

const FaqPage = () => {
    const [openIndex, setOpenIndex] = useState(null);
    const [faqData, setFaqData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchFaqs = async () => {
            const { data, error } = await supabase
                .from('faqs')
                .select('*')
                .order('position', { ascending: true });
            
            if (error) {
                toast({ title: "Could not load FAQs", description: error.message, variant: "destructive" });
            } else {
                setFaqData(data);
            }
            setLoading(false);
        };
        fetchFaqs();
    }, []);

    const handleClick = (index) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <>
            <Helmet>
                <title>FAQ - U-Fill Dumpsters</title>
                <meta name="description" content="Find answers to frequently asked questions about our dumpster rental services, pricing, allowed materials, and booking process." />
            </Helmet>
            <div className="relative">
                <BackButton className="absolute top-4 left-4 z-20" />
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="container mx-auto max-w-4xl py-16 px-4"
                >
                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-bold text-yellow-400 mb-2">Frequently Asked Questions</h1>
                        <p className="text-lg text-blue-200">Your questions, answered.</p>
                    </div>
                    
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl">
                        {loading ? (
                            <div className="flex justify-center items-center py-20">
                                <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
                            </div>
                        ) : (
                            faqData.map((item, index) => (
                                <FaqItem
                                    key={item.id}
                                    q={item.question}
                                    a={item.answer}
                                    isOpen={openIndex === index}
                                    onClick={() => handleClick(index)}
                                />
                            ))
                        )}
                    </div>
                </motion.div>
            </div>
        </>
    );
};

export default FaqPage;