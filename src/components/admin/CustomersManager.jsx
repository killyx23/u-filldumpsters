import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, User, Mail, Phone, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');

export const CustomersManager = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterLetter, setFilterLetter] = useState('All');
    const navigate = useNavigate();

    const fetchCustomers = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true });

        if (error) {
            toast({ title: "Failed to load customers", variant: "destructive" });
        } else {
            setCustomers(data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    const filteredCustomers = useMemo(() => {
        if (filterLetter === 'All') return customers;
        return customers.filter(c => c.name.toUpperCase().startsWith(filterLetter));
    }, [customers, filterLetter]);

    if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;

    return (
        <div className="flex">
            <div className="w-16 flex-shrink-0 bg-white/5 p-2 rounded-lg flex flex-col items-center gap-1 mr-6">
                <button 
                    onClick={() => setFilterLetter('All')} 
                    className={`w-10 h-10 flex items-center justify-center rounded-md text-lg font-bold transition-colors ${filterLetter === 'All' ? 'bg-yellow-400 text-gray-900' : 'hover:bg-white/20'}`}
                >
                    All
                </button>
                {ALPHABET.map(letter => (
                    <button 
                        key={letter} 
                        onClick={() => setFilterLetter(letter)}
                        className={`w-10 h-10 flex items-center justify-center rounded-md text-lg font-bold transition-colors ${filterLetter === letter ? 'bg-yellow-400 text-gray-900' : 'hover:bg-white/20'}`}
                    >
                        {letter}
                    </button>
                ))}
            </div>
            <div className="flex-grow bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20">
                {filteredCustomers.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredCustomers.map(customer => (
                            <div 
                                key={customer.id} 
                                onClick={() => navigate(`/admin/customer/${customer.id}`)} 
                                className="bg-white/5 p-4 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
                            >
                                <div className="flex items-center mb-2">
                                    <User className="h-5 w-5 mr-2 text-yellow-400" />
                                    <h3 className="font-bold text-lg truncate flex-grow">{customer.name}</h3>
                                    {customer.unverified_address && (
                                        <Tooltip>
                                            <TooltipTrigger>
                                                <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Address verification was skipped by this customer.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                </div>
                                <div className="text-sm space-y-1 text-blue-200">
                                    <p className="flex items-center truncate"><Mail className="h-4 w-4 mr-2 flex-shrink-0" />{customer.email}</p>
                                    <p className="flex items-center truncate"><Phone className="h-4 w-4 mr-2 flex-shrink-0" />{customer.phone}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16">
                        <p className="text-xl">No customers found starting with "{filterLetter}".</p>
                    </div>
                )}
            </div>
        </div>
    );
};