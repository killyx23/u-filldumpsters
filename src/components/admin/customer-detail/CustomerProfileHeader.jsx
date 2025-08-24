import React from 'react';
import { Repeat, AlertTriangle, Bell, ShieldAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const CustomerProfileHeader = ({ customer, bookingsCount }) => {
    const isRepeatCustomer = bookingsCount > 1;

    return (
        <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="text-3xl font-bold text-white">{customer.name}</h2>
                <div className="flex items-center space-x-3">
                    {customer.has_unread_notes && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                 <span className="cursor-help">
                                    <Bell className="h-6 w-6 text-yellow-400 animate-pulse"/>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="bg-gray-900 border-yellow-500 text-white">
                                <p>This customer has unread notes.</p>
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {customer.unverified_address && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                 <span className="cursor-help">
                                    <AlertTriangle className="h-6 w-6 text-orange-500"/>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="bg-gray-900 border-orange-500 text-white">
                                <p>Address verification was skipped by this customer.</p>
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {customer.has_incomplete_verification && (
                         <Tooltip>
                            <TooltipTrigger asChild>
                                 <span className="cursor-help">
                                    <ShieldAlert className="h-6 w-6 text-red-500"/>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="bg-gray-900 border-red-500 text-white">
                                <p>This customer has incomplete verification info (license/plate).</p>
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>
            </div>
            <div className="flex items-center mt-2 space-x-2">
               {isRepeatCustomer && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300"><Repeat className="mr-1 h-3 w-3"/>Repeat Customer</span>}
               <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300">{bookingsCount} Total Bookings</span>
            </div>
        </>
    );
};
