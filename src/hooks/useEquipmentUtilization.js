
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';

/**
 * Hook for calculating equipment utilization rates from booking data
 * @returns {Object} Utilization data and calculations
 */
export const useEquipmentUtilization = () => {
  const [bookingEquipment, setBookingEquipment] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [bookingEquipRes, equipmentRes] = await Promise.all([
          supabase
            .from('booking_equipment')
            .select('*, bookings(drop_off_date, pickup_date), equipment(name)'),
          
          supabase
            .from('equipment_inventory')
            .select('*'),
        ]);

        if (bookingEquipRes.error) {
          console.error('[Equipment Utilization] Booking equipment fetch error:', bookingEquipRes.error);
          throw bookingEquipRes.error;
        }

        if (equipmentRes.error) {
          console.error('[Equipment Utilization] Equipment fetch error:', equipmentRes.error);
          throw equipmentRes.error;
        }

        setBookingEquipment(bookingEquipRes.data || []);
        setEquipment(equipmentRes.data || []);

      } catch (err) {
        console.error('[Equipment Utilization] Error fetching utilization data:', err);
        setError(err.message);
        // Don't throw - allow component to render with empty data
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const utilizationData = useMemo(() => {
    if (!equipment.length || !bookingEquipment.length) return [];

    return equipment.map(eq => {
      try {
        const rentals = bookingEquipment.filter(be => be.equipment_id === eq.id);
        
        // Calculate total rental days
        const totalDays = rentals.reduce((sum, rental) => {
          if (!rental.bookings?.drop_off_date || !rental.bookings?.pickup_date) return sum;
          
          try {
            const start = new Date(rental.bookings.drop_off_date);
            const end = new Date(rental.bookings.pickup_date);
            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            
            return sum + (isNaN(days) ? 0 : Math.max(0, days));
          } catch (dateErr) {
            console.warn(`[Equipment Utilization] Invalid dates for booking:`, rental.bookings, dateErr);
            return sum;
          }
        }, 0);

        // Calculate days since purchase
        let daysSincePurchase = 0;
        try {
          const purchaseDate = new Date(eq.purchase_date);
          daysSincePurchase = Math.ceil((new Date() - purchaseDate) / (1000 * 60 * 60 * 24));
          daysSincePurchase = Math.max(1, daysSincePurchase); // Ensure at least 1 day
        } catch (dateErr) {
          console.warn(`[Equipment Utilization] Invalid purchase date for equipment ${eq.id}:`, dateErr);
          daysSincePurchase = 1;
        }
        
        // Utilization rate
        const utilizationRate = daysSincePurchase > 0 
          ? (totalDays / daysSincePurchase) * 100 
          : 0;

        return {
          id: eq.id,
          name: eq.name || 'Unknown',
          type: eq.equipment_type || 'Unknown',
          totalRentals: rentals.length,
          totalDays,
          daysSincePurchase,
          utilizationRate: Math.min(utilizationRate, 100).toFixed(2),
          status: eq.status || 'Unknown',
        };
      } catch (itemErr) {
        console.error(`[Equipment Utilization] Error processing equipment ${eq.id}:`, itemErr);
        return {
          id: eq.id,
          name: eq.name || 'Unknown',
          type: eq.equipment_type || 'Unknown',
          totalRentals: 0,
          totalDays: 0,
          daysSincePurchase: 1,
          utilizationRate: '0.00',
          status: 'Error',
          error: itemErr.message
        };
      }
    });
  }, [equipment, bookingEquipment]);

  return {
    utilizationData,
    loading,
    error
  };
};
