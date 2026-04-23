
import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export function SyncStatusIndicator() {
  const navigate = useNavigate();
  const [status, setStatus] = useState({
    connected: false,
    subscriptions: 0,
    lastSync: null,
    latency: null
  });

  useEffect(() => {
    // Listen for price change events to update status
    const handlePriceChange = (event) => {
      setStatus(prev => ({
        ...prev,
        connected: true,
        lastSync: event.detail.timestamp,
        subscriptions: 1
      }));
    };

    window.addEventListener('equipment-price-changed', handlePriceChange);

    // Check if sync manager is initialized
    if (window.equipmentPriceSync) {
      setStatus(prev => ({ ...prev, connected: true, subscriptions: 1 }));
    }

    return () => {
      window.removeEventListener('equipment-price-changed', handlePriceChange);
    };
  }, []);

  const getStatusColor = () => {
    if (!status.connected) return 'bg-red-500';
    if (status.subscriptions === 0) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusText = () => {
    if (!status.connected) return 'Disconnected';
    if (status.subscriptions === 0) return 'No Subscriptions';
    return 'Connected';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            onClick={() => navigate('/admin/equipment-sync')}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-full cursor-pointer hover:bg-gray-800 transition-colors"
          >
            <div className={`h-2 w-2 rounded-full ${getStatusColor()} ${status.connected ? 'animate-pulse' : ''}`} />
            <span className="text-xs text-white font-medium">{getStatusText()}</span>
            {status.subscriptions > 0 && (
              <Badge className="h-5 px-1.5 text-[10px] bg-blue-600">
                {status.subscriptions}
              </Badge>
            )}
            <Activity className="h-3 w-3 text-gray-400" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-gray-900 border-gray-700 text-white">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Status:</span>
              <span className="font-semibold text-white">{getStatusText()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Subscriptions:</span>
              <span className="font-semibold text-white">{status.subscriptions}</span>
            </div>
            {status.lastSync && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Last Sync:</span>
                <span className="font-semibold text-white">
                  {format(new Date(status.lastSync), 'h:mm:ss a')}
                </span>
              </div>
            )}
            <div className="pt-1 border-t border-gray-700 text-gray-400 italic">
              Click to monitor sync details
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
