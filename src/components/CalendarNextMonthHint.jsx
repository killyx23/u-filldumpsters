import React from 'react';
import { ChevronRight } from 'lucide-react';

export const CalendarNextMonthHint = () => (
  <p
    className="mt-2 border-t border-gray-700 px-3 py-2 text-center text-xs text-gray-300"
    role="status"
  >
    No dates left this month. Click
    <ChevronRight className="mx-0.5 inline h-3 w-3 align-text-bottom" aria-hidden />
    for more available dates.
  </p>
);
