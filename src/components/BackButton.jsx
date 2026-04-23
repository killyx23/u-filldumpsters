import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BackButton = ({ className }) => {
    const navigate = useNavigate();

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className={className}
        >
            <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                className="h-12 w-12 rounded-full text-white hover:bg-white/20 hover:text-yellow-300 transition-colors duration-300"
                aria-label="Go back to previous page"
            >
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </motion.div>
    );
};

export default BackButton;