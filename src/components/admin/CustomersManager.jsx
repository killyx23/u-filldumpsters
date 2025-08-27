import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, UserPlus, Search, User, AlertCircle, Bell } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export const CustomersManager = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchCustomers = useCallback(async () => {
        setLoading(true);
        let query = supabase.from('customers').select('*');
        if (searchTerm) {
            query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`);
        }
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
            toast({ title: "Failed to fetch customers", description: error.message, variant: "destructive" });
        } else {
            setCustomers(data);
        }
        setLoading(false);
    }, [searchTerm]);

    useEffect(() => {
        const handler = setTimeout(() => {
            fetchCustomers();
        }, 500); // Debounce search
        return () => clearTimeout(handler);
    }, [searchTerm, fetchCustomers]);
    
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-white/10 p-6 rounded-2xl shadow-xl"
        >
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Manage Customers</h2>
                <div className="flex gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <Input 
                            placeholder="Search by name, email, phone..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 bg-white/5 border-white/20"
                        />
                    </div>
                    <Button disabled className="bg-green-600 hover:bg-green-700">
                        <UserPlus className="mr-2 h-4 w-4" /> Add Customer
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-white/20">
                                <th className="p-4 text-blue-200">Name</th>
                                <th className="p-4 text-blue-200">Contact</th>
                                <th className="p-4 text-blue-200">Address</th>
                                <th className="p-4 text-blue-200 text-center">Status</th>
                                <th className="p-4 text-blue-200 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {customers.map(customer => (
                                <tr key={customer.id} className="border-b border-white/10 hover:bg-white/5 transition-colors">
                                    <td className="p-4 font-medium">{customer.name}</td>
                                    <td className="p-4">
                                        <p>{customer.email}</p>
                                        <p className="text-sm text-gray-400">{customer.phone}</p>
                                    </td>
                                    <td className="p-4 text-sm">{`${customer.street}, ${customer.city}`}</td>
                                    <td className="p-4 text-center">
                                         <div className="flex justify-center items-center gap-2">
                                            {customer.unverified_address && (
                                                 <Tooltip>
                                                    <TooltipTrigger><AlertCircle className="h-5 w-5 text-red-400" /></TooltipTrigger>
                                                    <TooltipContent><p>Address was not verified by customer.</p></TooltipContent>
                                                 </Tooltip>
                                            )}
                                            {customer.has_unread_notes && (
                                                 <Tooltip>
                                                    <TooltipTrigger><Bell className="h-5 w-5 text-yellow-400 animate-pulse" /></TooltipTrigger>
                                                    <TooltipContent><p>This customer has unread notes.</p></TooltipContent>
                                                 </Tooltip>
                                            )}
                                         </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <Link to={`/admin/customer/${customer.id}`}>
                                            <Button variant="outline" size="sm" className="text-white border-white/30 hover:bg-white/10 hover:text-white">
                                                <User className="mr-2 h-4 w-4" /> View Details
                                            </Button>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </motion.div>
    );
};