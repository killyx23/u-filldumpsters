import React from 'react';
import { Bluetooth, ExternalLink, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QRCode from 'qrcode.react';

export function IglooKeyUnlockPanel({
  shareableUrl,
  compact = false,
}) {
  if (!shareableUrl) return null;

  return (
    <div className={compact
      ? 'bg-black/30 p-4 rounded-lg border border-yellow-400/40 space-y-3'
      : 'space-y-4'}
    >
      <div className="flex items-center gap-2">
        <Bluetooth className="h-4 w-4 text-yellow-400" />
        <p className="text-xs uppercase tracking-widest text-yellow-400 font-semibold">
          Digital unlock key
        </p>
      </div>
      <p className={compact ? 'text-sm text-gray-300' : 'text-white text-lg'}>
        Open this link on your phone at the padlock to unlock over Bluetooth.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Button asChild className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
          <a href={shareableUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open unlock link
          </a>
        </Button>
        {!compact && (
          <div className="bg-white p-2 rounded-md w-fit">
            <QRCode value={shareableUrl} size={112} />
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 break-all">{shareableUrl}</p>
      <p className={`flex gap-2 ${compact ? 'text-xs text-gray-400' : 'text-sm text-blue-200'}`}>
        <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
        If you will not have access to a smart device during pickup, use the keypad PIN below when it is available.
      </p>
    </div>
  );
}
