import React from 'react';
    import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
    import { Info } from 'lucide-react';

    export const AddonSection = ({ icon, title, children, tooltipContent }) => (
        <div className="bg-white/5 p-6 rounded-lg">
            <div className="flex items-center mb-4">
                <div className="text-yellow-400 mr-3">{icon}</div>
                <h4 className="text-xl font-semibold text-white">{title}</h4>
                {tooltipContent && (
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <button className="ml-2 text-blue-300 hover:text-yellow-400 transition-colors">
                        <Info className="h-5 w-5"/>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-gray-900 border-blue-400 text-white max-w-sm p-4">
                      {tooltipContent}
                    </TooltipContent>
                  </Tooltip>
                )}
            </div>
            {children}
        </div>
    );