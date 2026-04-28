import { supabase } from '@/lib/customSupabaseClient';

export const AvailabilityService = {
  /**
   * Fetches availability for a specific service and date
   * @param {number} serviceId - The ID of the service
   * @param {string} date - The date string (YYYY-MM-DD)
   * @returns {Promise<Object|null>} The availability record or null if not found
   */
  async getAvailabilityForDate(serviceId, date) {
    return this.getDateSpecificAvailability(serviceId, date);
  },

  /**
   * Fetches specific availability for a specific service and date directly from date_specific_availability
   * @param {number} serviceId - The ID of the service
   * @param {string} date - The date string (YYYY-MM-DD)
   * @returns {Promise<Object|null>} The availability record or null if not found
   */
  async getDateSpecificAvailability(serviceId, date) {
    try {
      const { data, error } = await supabase
        .from('date_specific_availability')
        .select('*')
        .eq('service_id', serviceId)
        .eq('date', date)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching date specific availability:', error);
        return null;
      }
      return data; // Returns null if no record exists
    } catch (err) {
      console.error('Exception in getDateSpecificAvailability:', err);
      return null;
    }
  },

  /**
   * Fetches availability for a date range
   * @param {number} serviceId - The ID of the service
   * @param {string} startDate - The start date string (YYYY-MM-DD)
   * @param {string} endDate - The end date string (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of availability records
   */
  async getAvailabilityForDateRange(serviceId, startDate, endDate) {
    try {
      const { data, error } = await supabase
        .from('date_specific_availability')
        .select('*')
        .eq('service_id', serviceId)
        .gte('date', startDate)
        .lte('date', endDate);

      if (error) {
        console.error('Error fetching availability range:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('Exception in getAvailabilityForDateRange:', err);
      return [];
    }
  }
};