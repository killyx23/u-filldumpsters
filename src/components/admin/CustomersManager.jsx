import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  UserPlus,
  Search,
  User,
  AlertCircle,
  Bell,
  MessageCircle,
  ShieldAlert,
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const UnreadNotesIcon = ({ customerId }) => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchUnreadNotes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('customer_notes')
      .select('content, created_at, source')
      .eq('customer_id', customerId)
      .eq('is_read', false)
      .eq('author_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      toast({ title: 'Error fetching notes', description: error.message, variant: 'destructive' });
    } else {
      setNotes(data || []);
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
                <Bell className="h-5 w-5 animate-pulse text-yellow-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Unread message — click to open Chat.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 border-yellow-500 bg-gray-900 text-white">
        <div className="mb-2 font-bold text-yellow-400">Unread messages</div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : notes.length > 0 ? (
          <div className="space-y-2">
            {notes.map((note, index) => (
              <div key={index} className="rounded-md bg-white/10 p-2 text-sm">
                {note.source ? (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-300/90">
                    {note.source}
                  </p>
                ) : null}
                <p className="line-clamp-2">{note.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm">Unread activity — open Chat to review.</p>
        )}
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
          <TooltipContent className="border-orange-500 bg-gray-900 text-white">
            <p>Address verification was skipped. Click to review.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
};

const IncompleteVerificationIcon = ({ customerId }) => {
  const navigate = useNavigate();

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/admin/customer/${customerId}?tab=verification`);
  };

  return (
    <span onClick={handleClick} className="cursor-pointer">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <ShieldAlert className="h-5 w-5 text-red-400" />
          </TooltipTrigger>
          <TooltipContent className="border-red-500 bg-gray-900 text-white">
            <p>Incomplete verification. Click to review.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
};

const CustomerTable = ({ customers, emptyLabel }) => {
  if (!customers.length) {
    return <p className="py-10 text-center text-blue-200">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/20">
            <th className="p-4 text-blue-200">Name</th>
            <th className="p-4 text-blue-200">Contact</th>
            <th className="p-4 text-blue-200">Address</th>
            <th className="p-4 text-center text-blue-200">Status</th>
            <th className="p-4 text-right text-blue-200">Actions</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr
              key={customer.id}
              className="border-b border-white/10 transition-colors hover:bg-white/5"
            >
              <td className="p-4 font-medium">
                <span className="inline-flex items-center gap-2">
                  {customer.name}
                  {customer.has_unread_notes ? (
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]"
                      title="Unread message"
                      aria-label="Unread message"
                    />
                  ) : null}
                </span>
              </td>
              <td className="p-4">
                <p>{customer.email}</p>
                <p className="text-sm text-gray-400">{customer.phone}</p>
              </td>
              <td className="p-4 text-sm">{`${customer.street || '—'}, ${customer.city || ''}`}</td>
              <td className="p-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  {customer.unverified_address && (
                    <UnverifiedAddressIcon customerId={customer.id} />
                  )}
                  {customer.has_incomplete_verification && (
                    <IncompleteVerificationIcon customerId={customer.id} />
                  )}
                  {customer.has_unread_notes && <UnreadNotesIcon customerId={customer.id} />}
                </div>
              </td>
              <td className="p-4 text-right">
                <Link to={`/admin/customer/${customer.id}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                  >
                    <User className="mr-2 h-4 w-4" /> View Details
                  </Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const CustomersManager = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [section, setSection] = useState('booked');

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('customers').select('*');
    if (searchTerm) {
      query = query.or(
        `name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`,
      );
    }
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      toast({
        title: 'Failed to fetch customers',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setCustomers(data || []);
    }
    setLoading(false);
  }, [searchTerm]);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchCustomers();
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm, fetchCustomers]);

  // Keep Status fresh after Chat clears unread / returning from customer file
  useEffect(() => {
    const onFocus = () => {
      fetchCustomers();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCustomers]);

  const bookedCustomers = customers.filter((c) => (c.segment || 'booked') === 'booked');
  const feedbackLeads = customers.filter((c) => c.segment === 'feedback_lead');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl bg-white/10 p-6 shadow-xl"
    >
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-2xl font-bold text-white">Manage Customers</h2>
        <div className="flex gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by name, email, phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-white/20 bg-white/5 pl-10"
            />
          </div>
          <Button disabled className="bg-green-600 hover:bg-green-700">
            <UserPlus className="mr-2 h-4 w-4" /> Add Customer
          </Button>
        </div>
      </div>

      <Tabs value={section} onValueChange={setSection} className="w-full">
        <TabsList className="mb-4 grid w-full max-w-xl grid-cols-2 bg-black/30">
          <TabsTrigger value="booked" className="data-[state=active]:bg-blue-600">
            Customers ({bookedCustomers.length})
          </TabsTrigger>
          <TabsTrigger value="feedback" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
            <MessageCircle className="mr-1 h-4 w-4" />
            How can we do better ({feedbackLeads.length})
          </TabsTrigger>
        </TabsList>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
          </div>
        ) : (
          <>
            <TabsContent value="booked">
              <p className="mb-4 text-sm text-blue-200">
                People who have completed a booking with us. Status shows unread messages,
                skipped address verification, and incomplete verification until dealt with.
              </p>
              <CustomerTable
                customers={bookedCustomers}
                emptyLabel="No booked customers match your search."
              />
            </TabsContent>
            <TabsContent value="feedback">
              <p className="mb-4 text-sm text-amber-100/90">
                Leave-early feedback, How can we do better survey leads, and Contact Us inquiries
                from people without a completed booking. Unread messages show a yellow bell / name
                dot until Chat is opened.
              </p>
              <CustomerTable
                customers={feedbackLeads}
                emptyLabel="No how-can-we-do-better leads yet."
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </motion.div>
  );
};
