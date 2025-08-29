import React from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import BackButton from '@/components/BackButton';

const faqData = [
  {
    question: "What size dumpsters do you offer?",
    answer: "We offer a 16-yard dumpster, which is 16 ft long, 7 ft wide, and 4 ft high. It's perfect for a wide range of projects including home renovations, garage cleanouts, and construction debris."
  },
  {
    question: "What is the Dump Loader Trailer rental service?",
    answer: "The Dump Loader Trailer is a versatile piece of equipment that combines a loader with a dump trailer. It's ideal for landscaping projects involving materials like rock, mulch, or gravel, as well as for moving heavy items and clearing debris. It's a great value for projects that require both lifting and hauling capabilities."
  },
  {
    question: "What is included in the rental price?",
    answer: "The rental price for the 16-yard dumpster includes delivery, pickup, and disposal of up to 2.5 tons of waste. Disposal costs are extra and are charged per ton, with the first ton at a flat rate of $40. For the Dump Loader, it includes the rental of the equipment for the specified period. Additional charges may apply for overweight loads or extended rental periods."
  },
  {
    question: "How long is the standard rental period?",
    answer: "Our average rental period is between 1 and 7 days. We also offer weekly rates for extended rentals. If you need the rental for a longer duration, please contact us for custom pricing and availability."
  },
  {
    question: "What materials are not allowed in the dumpster?",
    answer: "Prohibited items include hazardous materials (paint, chemicals, asbestos), tires, and batteries. Mattresses and TVs can be taken to the dump, but they require an extra $15 fee per TV or mattress. Please refer to our user agreement for a complete list of restricted items. Disposing of these items in the dumpster may result in additional fees."
  },
  {
    question: "How do I schedule a delivery and pickup?",
    answer: "You can schedule your drop-off and pickup dates and times directly on our website during the booking process. Our hours of operation are listed on the website. For dumpster rentals, the drop-off window is typically between 8:00 a.m. and 10:00 a.m. on the morning of delivery. Pick-up is between 8:00 a.m. and 10:00 p.m. on the pick-up date. Important: on the pick-up date, the dumpster must be ready by 8:00 a.m., and nothing must obstruct it or the surrounding area that could interfere with pick-up; otherwise, it may be subject to a dry run charge and/or additional fees."
  },
  {
    question: "How does the Dump Loader Trailer rental pickup and return work?",
    answer: "The Dump Loader Trailer rental pick-up starts at 8:00 a.m. and must be returned by 10:00 p.m. on the day it is scheduled for return. You can rent it for a single day or for multiple days; weekly discounts are available—please contact us for details. Pick-up is from our location on the south side of Saratoga Springs. The exact pick-up address and the code to unlock the trailer will be provided in your receipt. The trailer can be picked up anytime after 8:00 a.m. on your scheduled day, but the charge remains the same regardless of pick-up time, and it must still be returned by 10:00 p.m. on the scheduled return date. The dump loader should be properly swept out and cleaned of all debris upon return, or it may be subject to a cleaning fee of a minimum of $20 or more."
  },
  {
    question: "How are rock, gravel, and mulch deliveries scheduled?",
    answer: "Rock, gravel, and mulch deliveries are scheduled through our system. As you choose the aggregate you want, you will be able to select a convenient time slot on the day you wish to have it delivered."
  },
  {
    question: "Where at my location will you be leaving the dumpster or aggregate that I ordered?",
    answer: "All dumpsters must be placed in the driveway on solid ground on your property that won't be damaged by driving heavy equipment over, and has clear and easy access to the location you would like the dumpster to be left. Any placement on the street requires that you check with your local city for approval. We are not responsible for any fines or fees that would be imposed by leaving it on the street; the customer takes full responsibility for knowing all local city codes and making us aware if not dropping anywhere else than the driveway. For all aggregate being delivered, the same also applies. At the time of delivery or pick-up (if doing a dumpster rental), there should be no obstacles in the way for the delivery to easily back in, including parked cars or any other obstructions. Cars in the driveway must be moved and out of the way, and the driveway must be open and clear of any other vehicles. The delivery trucks and equipment are long and cannot just back into any location. They need adequate space on both sides of the vehicle to properly drop off/pick up or deliver this heavy equipment and/or aggregate. Please be mindful of this when scheduling your delivery or dumpster drop-off. Failure to do so may cause a dry run charge and additional fees."
  },
  {
    question: "How can I use the Customer Portal?",
    answer: "After your booking is confirmed, you will receive a unique Customer ID. You can use this ID along with your phone number to log in to our Customer Portal. The portal allows you to view your order history, check the status of your current bookings, download or re-email your receipts, view notes related to your account, and even add new notes or upload additional pictures for rental verification directly to your file. This provides a secure and convenient way to manage your rental information."
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
            </div>
        </>
    );
};

export default FaqPage;