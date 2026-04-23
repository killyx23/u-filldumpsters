
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { initializeEquipmentPricing } from '@/utils/initializeEquipmentPricing';

/**
 * Hook to initialize equipment pricing table on app mount
 * Only runs for authenticated admin users
 */
export function useEquipmentPricingInit() {
  const { user, loading: authLoading } = useAuth();
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initialize = async () => {
      // Wait for auth to complete
      if (authLoading) return;

      // Only initialize for admin users
      const isAdmin = user?.user_metadata?.is_admin === true;
      if (!isAdmin) {
        setInitialized(true);
        return;
      }

      // Skip if already initialized
      if (initialized) return;

      console.log('[useEquipmentPricingInit] Starting equipment pricing initialization for admin user');
      setLoading(true);
      setError(null);

      try {
        const result = await initializeEquipmentPricing();

        if (result.initialized) {
          console.log('[useEquipmentPricingInit] Initialization complete:', result.message);
          setInitialized(true);
        } else {
          console.error('[useEquipmentPricingInit] Initialization failed:', result.error);
          setError(result.error);
        }
      } catch (err) {
        console.error('[useEquipmentPricingInit] Unexpected error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [user, authLoading, initialized]);

  return {
    initialized,
    loading,
    error
  };
}
