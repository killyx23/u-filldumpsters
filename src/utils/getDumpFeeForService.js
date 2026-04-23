import { supabase } from '@/lib/customSupabaseClient';

export const getDumpFeeForService = async (serviceId) => {
  try {
    const { data, error } = await supabase
      .from('dump_fees')
      .select('*')
      .eq('service_id', serviceId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') { // not found
        console.error('Error fetching dump fee:', error);
      }
      return null;
    }
    return data;
  } catch (error) {
    console.error('Error in getDumpFeeForService:', error);
    return null;
  }
};