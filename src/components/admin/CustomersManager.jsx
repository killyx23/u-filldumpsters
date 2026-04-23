import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, UserPlus, Search, User, AlertCircle, Bell } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const UnreadNotesIcon = ({ customerId }) => {
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const fetchUnreadNotes = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('customer_notes')
            .select('content, created_at')
            .eq('customer_id', customerId)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            toast({ title: 'Error fetching notes', description: error.message, variant: 'destructive' });
        } else {
            setNotes(data);
        }
        setLoading(false);
    };

    const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/admin/customer/${customerId}?tab=notes`);
    };

    return (
        <Popover onOpenChange={(open) => open && fetchUnreadNotes()}>
            <PopoverTrigger asChild>
                <span onClick={handleClick} className="cursor-pointer">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Bell className="h-5 w-5 text-yellow-400 animate-pulse" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>This customer has unread notes. Click to view.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </span>
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-gray-900 border-yellow-500 text-white">
                <div className="font-bold text-yellow-400 mb-2">Unread Notes</div>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> :
                    notes.length > 0 ? (
                        <div className="space-y-2">
                            {notes.map((note, index) => (
                                <div key={index} className="text-sm p-2 bg-white/10 rounded-md">
                                    <p className="line-clamp-2">{note.content}</p>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-sm">No unread notes found.</p>
                }
            </PopoverContent>
        </Popover>
    );
};

const UnverifiedAddressIcon = ({ customerId }) => {
    const navigate = useNavigate();
    
    const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/admin/customer/${customerId}?tab=profile`);
    };

    return (
         <span onClick={handleClick} className="cursor-pointer">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                       <AlertCircle className="h-5 w-5 text-orange-400" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-gray-900 border-orange-500 text-white">
                        <p>Address verification was skipped. Click to review.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </span>
    );
};

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
                                            {customer.unverified_address && <UnverifiedAddressIcon customerId={customer.id} />}
                                            {customer.has_unread_notes && <UnreadNotesIcon customerId={customer.id} />}
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