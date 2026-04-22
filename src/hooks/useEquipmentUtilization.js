
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Hook for calculating equipment utilization rates from booking data
 * @returns {Object} Utilization data and calculations
 */
export const useEquipmentUtilization = () => {
  const [bookingEquipment, setBookingEquipment] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bookingEquipRes, equipmentRes] = await Promise.all([
          supabase
            .from('booking_equipment')
            .select('*, bookings(drop_off_date, pickup_date), equipment(name)'),
          
          supabase
            .from('equipment_inventory')
            .select('*'),
        ]);

        if (bookingEquipRes.error) throw bookingEquipRes.error;
        if (equipmentRes.error) throw equipmentRes.error;

        setBookingEquipment(bookingEquipRes.data || []);
        setEquipment(equipmentRes.data || []);
      } catch (error) {
        console.error('Error fetching utilization data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const utilizationData = useMemo(() => {
    if (!equipment.length || !bookingEquipment.length) return [];

    return equipment.map(eq => {
      const rentals = bookingEquipment.filter(be => be.equipment_id === eq.id);
      
      // Calculate total rental days
      const totalDays = rentals.reduce((sum, rental) => {
        if (!rental.bookings?.drop_off_date || !rental.bookings?.pickup_date) return sum;
        
        const start = new Date(rental.bookings.drop_off_date);
        const end = new Date(rental.bookings.pickup_date);
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        
        return sum + days;
      }, 0);

      // Calculate days since purchase
      const purchaseDate = new Date(eq.purchase_date);
      const daysSincePurchase = Math.ceil((new Date() - purchaseDate) / (1000 * 60 * 60 * 24));
      
      // Utilization rate
      const utilizationRate = daysSincePurchase > 0 
        ? (totalDays / daysSincePurchase) * 100 
        : 0;

      return {
        id: eq.id,
        name: eq.name,
        type: eq.equipment_type,
        totalRentals: rentals.length,
        totalDays,
        daysSincePurchase,
        utilizationRate: Math.min(utilizationRate, 100).toFixed(2),
        status: eq.status,
      };
    });
  }, [equipment, bookingEquipment]);

  return {
    utilizationData,
    loading,
  };
};
