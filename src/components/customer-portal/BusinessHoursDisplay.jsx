
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, AlertCircle } from 'lucide-react';
import { fetchBusinessHours, isWithinBusinessHours } from '@/services/AIAssistantService';

export const BusinessHoursDisplay = () => {
  const [businessHours, setBusinessHours] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBusinessHours = async () => {
      try {
        const hours = await fetchBusinessHours();
        setBusinessHours(hours);
      } catch (error) {
        console.error('[BusinessHoursDisplay] Error loading hours:', error);
      } finally {
        setLoading(false);
      }
    };

    loadBusinessHours();
  }, []);

  if (loading) {
    return null;
  }

  // Default hours if not configured
  const defaultHours = {
    monday: { open: '09:00', close: '17:00' },
    tuesday: { open: '09:00', close: '17:00' },
    wednesday: { open: '09:00', close: '17:00' },
    thursday: { open: '09:00', close: '17:00' },
    friday: { open: '09:00', close: '17:00' },
    saturday: { open: '10:00', close: '14:00' },
    sunday: { open: null, close: null }
  };

  const hours = businessHours || defaultHours;
  const withinHours = isWithinBusinessHours(hours);

  return (
    <Card className="bg-gray-800/50 border-gray-700 mb-4">
      <CardContent className="p-4">
        {withinHours ? (
          <div className="flex items-center gap-3 text-green-400">
            <Clock className="h-5 w-5" />
            <div>
              <p className="font-semibold text-sm">We're here to help!</p>
              <p className="text-xs text-gray-400">Our support team is available now</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-yellow-400">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-semibold text-sm">After Hours</p>
              <p className="text-xs text-gray-400">Our team will respond during business hours: Mon-Fri 9AM-5PM, Sat 10AM-2PM</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
