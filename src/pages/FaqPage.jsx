import React from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';

const faqData = [
  {
    question: "What size dumpsters do you offer?",
    answer: "We offer a 16-yard dumpster, which is perfect for a wide range of projects including home renovations, garage cleanouts, and construction debris. Its dimensions are 14' L x 7.5' W x 4.5' H."
  },
  {
    question: "What is the Dump Loader Trailer rental service?",
    answer: "The Dump Loader Trailer is a versatile piece of equipment that combines a loader with a dump trailer. It's ideal for landscaping projects involving materials like rock, mulch, or gravel, as well as for moving heavy items and clearing debris. It's a great value for projects that require both lifting and hauling capabilities."
  },
    {
    question: "What is included in the rental price?",
    answer: "The rental price includes delivery, pickup, and disposal of up to 2 tons of waste for the 16-yard dumpster. For the Dump Loader, it includes the rental of the equipment for the specified period. Additional charges may apply for overweight loads or extended rental periods."
  },
  {
    question: "How long is the standard rental period?",
    answer: "Our standard rental period is 1-4 days. If you need the rental for a longer duration, please contact us for custom pricing and availability."
  },
  {
    question: "What materials are not allowed in the dumpster?",
    answer: "Prohibited items include hazardous materials (paint, chemicals, asbestos), tires, batteries, refrigerators, and electronics. Please refer to our user agreement for a complete list of restricted items. Disposing of these items in the dumpster may result in additional fees."
  },
  {
    question: "How do I schedule a delivery and pickup?",
    answer: "You can schedule your drop-off and pickup dates and times directly on our website during the booking process. We offer convenient time slots to fit your schedule."
  },
  {
    question: "Do I need to be present for delivery or pickup?",
    answer: "It's not required, but it is highly recommended, especially for delivery, to ensure we place the dumpster in the exact location you want. Please provide clear placement instructions during booking if you cannot be present."
  },
   {
    question: "What if I need to change my booking?",
    answer: "Please contact us as soon as possible if you need to make changes to your booking. We will do our best to accommodate your request based on availability. Changes may be subject to a fee if made within 24 hours of the scheduled delivery."
  },
  {
    question: "How do I pay for my rental?",
    answer: "We accept all major credit cards through our secure online payment system, powered by Stripe. Payment is required at the time of booking to confirm your reservation."
  }
];

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
        <p className="text-blue-200">{a}</p>
      </motion.div>
    </div>
  );
};

const FaqPage = () => {
    const [openIndex, setOpenIndex] = React.useState(null);

    const handleClick = (index) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <>
            <Helmet>
                <title>FAQ - U-Fill Dumpsters</title>
                <meta name="description" content="Find answers to frequently asked questions about our dumpster rental services, pricing, allowed materials, and booking process." />
            </Helmet>
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
                    {faqData.map((item, index) => (
                        <FaqItem
                            key={index}
                            q={item.question}
                            a={item.answer}
                            isOpen={openIndex === index}
                            onClick={() => handleClick(index)}
                        />
                    ))}
                </div>
            </motion.div>
        </>
    );
};

export default FaqPage;