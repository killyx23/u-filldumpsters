
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, MapPin, AlertTriangle, Truck, CheckCircle, Star, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { formatTimeWindow, shouldShowTimeWindow, isSelfServiceTrailer } from '@/utils/timeWindowFormatter';

export const StatusDetailsModal = ({ isOpen, onClose, type, customerId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen || !customerId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('bookings')
          .select('*')
          .eq('customer_id', customerId)
          .order('drop_off_date', { ascending: false });

        switch (type) {
          case 'active':
            query = query
              .in('status', ['Confirmed', 'Delivered', 'waiting_to_be_returned', 'Rescheduled', 'pending_payment'])
              .eq('pending_address_verification', false);
            break;
          case 'pending':
            query = query.eq('pending_address_verification', true);
            break;
          case 'upcoming':
            const today = new Date().toISOString().split('T')[0];
            query = query
              .in('status', ['Confirmed', 'Rescheduled', 'pending_payment'])
              .gte('drop_off_date', today);
            break;
          case 'completed':
            query = query.in('status', ['Completed', 'Returned', 'flagged']);
            break;
          default:
            break;
        }

        const { data: fetchedData, error } = await query;
        
        if (error) throw error;
        setData(fetchedData || []);
      } catch (error) {
        console.error('Error fetching modal data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, type, customerId]);

  if (!isOpen) return null;

  const getTitle = () => {
    switch (type) {
      case 'active': return 'Active Bookings';
      case 'pending': return 'Pending Address Verification';
      case 'upcoming': return 'Upcoming Deliveries';
      case 'completed': return 'Completed Rentals';
      default: return 'Details';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'active': return <CheckCircle className="h-6 w-6 text-green-400" />;
      case 'pending': return <MapPin className="h-6 w-6 text-yellow-400" />;
      case 'upcoming': return <Truck className="h-6 w-6 text-blue-400" />;
      case 'completed': return <Star className="h-6 w-6 text-gray-400" />;
      default: return null;
    }
  };

  const handleItemClick = (e, item) => {
    e.preventDefault();
    if (!item?.id) {
      console.error("Missing booking ID on click");
      return;
    }
    onClose();
    navigate(`/portal/bookings/${item.id}`);
  };

  const renderItemContent = (item) => {
    const planName = item.plan?.name || 'Custom Rental';
    const isDelivery = item.addons?.deliveryService || item.addons?.isDelivery;
    const showWindow = shouldShowTimeWindow(item.plan, isDelivery);
    const isSelfService = isSelfServiceTrailer(item.plan, isDelivery);
    
    const timeOptions = {
      isWindow: showWindow,
      isSelfService: isSelfService,
      serviceType: item.plan?.service_type
    };
    
    switch (type) {
      case 'active':
        return (
          <>
            <div className="flex-1">
              <h4 className="font-bold text-white flex items-center gap-2">
                Order #{item.id}
                <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full border border-green-500/30 uppercase tracking-wider">
                  {item.status.replace(/_/g, ' ')}
                </span>
              </h4>
              <p className="text-sm text-gray-300 mt-1">{planName}</p>
              <div className="flex items-center text-xs text-gray-400 mt-2">
                <Calendar className="h-3 w-3 mr-1" />
                Start: {format(parseISO(item.drop_off_date), 'MMM d, yyyy')} ({formatTimeWindow(item.drop_off_time_slot, timeOptions)})
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
          </>
        );
      case 'pending':
        return (
          <>
            <div className="flex-1">
              <h4 className="font-bold text-white flex items-center gap-2">
                Order #{item.id}
                <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30 uppercase tracking-wider flex items-center">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Action Required
                </span>
              </h4>
              <p className="text-sm text-gray-300 mt-1">{planName}</p>
              <p className="text-xs text-orange-300 mt-2 bg-orange-900/20 p-2 rounded border border-orange-500/20">
                Reason: {item.pending_verification_reason || 'Address verification required'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
          </>
        );
      case 'upcoming':
        return (
          <>
            <div className="flex-1">
              <h4 className="font-bold text-white">Order #{item.id}</h4>
              <p className="text-sm text-gray-300 mt-1">{planName}</p>
              <div className="flex flex-col gap-1 mt-2 text-xs text-gray-400">
                <span className="flex items-center text-blue-300">
                  <Calendar className="h-3 w-3 mr-1" />
                  Delivery: {format(parseISO(item.drop_off_date), 'MMM d, yyyy')} ({formatTimeWindow(item.drop_off_time_slot, timeOptions)})
                </span>
                <span className="flex items-center">
                  <MapPin className="h-3 w-3 mr-1" />
                  {item.delivery_address?.formatted_address || item.street}
                </span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
          </>
        );
      case 'completed':
        return (
          <>
            <div className="flex-1">
              <h4 className="font-bold text-white">Order #{item.id}</h4>
              <p className="text-sm text-gray-300 mt-1">{planName}</p>
              <div className="flex flex-col gap-1 mt-2 text-xs text-gray-400">
                <span className="flex items-center">
                  <CheckCircle className="h-3 w-3 mr-1 text-gray-500" />
                  Completed on {item.returned_at ? format(parseISO(item.returned_at), 'MMM d, yyyy') : format(parseISO(item.pickup_date), 'MMM d, yyyy')}
                </span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
          className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-800 bg-gray-900/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-800 rounded-lg">
                {getIcon()}
              </div>
              <h2 className="text-xl font-bold text-white">{getTitle()}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex items-center justify-between p-4 rounded-xl border border-gray-800 bg-gray-800/20">
                    <div className="space-y-3 flex-1">
                      <div className="h-5 bg-gray-700 rounded w-1/3"></div>
                      <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                      <div className="h-3 bg-gray-700 rounded w-1/4 mt-4"></div>
                    </div>
                    <div className="h-8 w-8 bg-gray-700 rounded-full ml-4"></div>
                  </div>
                ))}
              </div>
            ) : data.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="mx-auto w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                  {getIcon()}
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No Records Found</h3>
                <p className="text-gray-400 text-sm">
                  There are currently no bookings matching this status.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.map((item) => (
                  <div
                    key={item.id}
                    onClick={(e) => handleItemClick(e, item)}
                    className="group flex items-center justify-between p-5 rounded-xl border border-gray-800 bg-gray-800/30 hover:bg-gray-800 transition-all cursor-pointer"
                  >
                    {renderItemContent(item)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
