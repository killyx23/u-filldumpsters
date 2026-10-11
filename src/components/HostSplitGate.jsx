import { useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getCrossHostRedirect } from '@/utils/getAppOrigin';

/**
 * Staff pages stay on the staff address. Customer pages stay on the public address.
 * The redirect happens before those pages mount, so one login does not replace the other.
 */
export function HostSplitGate({ children }) {
  const location = useLocation();
  const target = getCrossHostRedirect(location);

  if (target && typeof window !== 'undefined') {
    window.location.replace(target);
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-500" aria-label="Opening the right site" />
      </div>
    );
  }

  return children;
}
