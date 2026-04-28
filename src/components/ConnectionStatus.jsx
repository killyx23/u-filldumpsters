import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export const ConnectionStatus = ({ status, onReconnect }) => {
    let dotColor = 'bg-gray-500';
    let text = 'Disconnected';
    let description = 'Real-time connection is offline.';

    if (status === 'connected') {
        dotColor = 'bg-green-500';
        text = 'Connected';
        description = 'Real-time connection is active. Messages will appear instantly.';
    } else if (status === 'connecting') {
        dotColor = 'bg-yellow-500 animate-pulse';
        text = 'Connecting...';
        description = 'Establishing real-time connection...';
    } else if (status === 'error') {
        dotColor = 'bg-red-500';
        text = 'Connection Error';
        description = 'Failed to connect. Click to retry.';
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div 
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-white/10 bg-black/30 ${status === 'error' ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'}`}
                        onClick={status === 'error' && onReconnect ? onReconnect : undefined}
                    >
                        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                        <span className="text-gray-300 font-medium">{text}</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent className="bg-gray-900 border-gray-700 text-white">
                    <p>{description}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};