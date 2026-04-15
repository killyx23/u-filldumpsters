import React from 'react';
import { motion } from 'framer-motion';

export const TypingIndicator = ({ isTyping, text }) => {
    if (!isTyping) return null;

    const dotVariants = {
        initial: { y: 0 },
        animate: { y: -5 }
    };

    const transition = {
        duration: 0.5,
        repeat: Infinity,
        repeatType: "reverse",
        ease: "easeInOut"
    };

    return (
        <div className="flex items-center space-x-2 text-xs text-gray-400 p-2">
            <span>{text}</span>
            <div className="flex space-x-1">
                <motion.div
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                    variants={dotVariants}
                    initial="initial"
                    animate="animate"
                    transition={{ ...transition, delay: 0 }}
                />
                <motion.div
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                    variants={dotVariants}
                    initial="initial"
                    animate="animate"
                    transition={{ ...transition, delay: 0.15 }}
                />
                <motion.div
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                    variants={dotVariants}
                    initial="initial"
                    animate="animate"
                    transition={{ ...transition, delay: 0.3 }}
                />
            </div>
        </div>
    );
};