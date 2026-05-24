import React, { useState } from 'react';
import { MapPin, ExternalLink, Maximize2, AlertTriangle, Navigation } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const buildDirectionsEmbedUrl = (apiKey, origin, destination) =>
  `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving`;

const buildDirectionsExternalUrl = (origin, destination) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;

const MapFrame = ({ src, title, className }) => (
  <iframe
    title={title}
    width="100%"
    className={className}
    loading="lazy"
    allowFullScreen
    src={src}
  />
);

export const PickupDirectionsMap = ({ customerAddress, businessAddress }) => {
  const [expanded, setExpanded] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!customerAddress || !businessAddress) {
    return null;
  }

  const externalUrl = buildDirectionsExternalUrl(customerAddress, businessAddress);

  if (!apiKey) {
    return (
      <div className="mt-3 bg-black/20 p-3 rounded-lg border border-amber-500/20">
        <p className="text-sm text-gray-400 flex items-center mb-2">
          <Navigation className="mr-2 h-4 w-4 text-blue-400" />
          <span aria-hidden>🗺️</span>
          <span className="ml-1">Directions</span>
        </p>
        <div className="flex items-start gap-2 text-amber-200/90 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Map preview is unavailable. Open directions in Google Maps instead.</p>
        </div>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-sm text-blue-400 hover:text-blue-300 mt-3 transition-colors"
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          Open directions in Google Maps
        </a>
      </div>
    );
  }

  const embedUrl = buildDirectionsEmbedUrl(apiKey, customerAddress, businessAddress);

  return (
    <div className="mt-3">
      <p className="text-sm text-gray-400 flex items-center mb-2">
        <Navigation className="mr-2 h-4 w-4 text-blue-400" />
        <span aria-hidden>🚗</span>
        <span className="ml-1">Live directions to pickup</span>
      </p>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative w-full rounded-md overflow-hidden border border-white/10 bg-slate-800 group text-left focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
        aria-label="Expand directions map"
      >
        <MapFrame
          src={embedUrl}
          title="Pickup directions preview"
          className="w-full h-[220px] md:h-[280px] border-0 pointer-events-none"
        />
        <span className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 text-white text-xs px-2 py-1 rounded border border-white/20 group-hover:bg-black/90 transition-colors">
          <Maximize2 className="h-3 w-3" />
          Tap to enlarge
        </span>
      </button>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2">
        <p className="text-xs text-gray-400 truncate" title={businessAddress}>
          <MapPin className="inline h-3 w-3 text-yellow-400 mr-1" />
          From your address to our yard
        </p>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open in Google Maps
        </a>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl w-[95vw] p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-yellow-400 flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <span aria-hidden>🗺️</span>
              Directions to pickup location
            </DialogTitle>
            <DialogDescription>
              Driving directions from your address to our business location.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md overflow-hidden border border-white/10">
            <MapFrame
              src={embedUrl}
              title="Pickup directions expanded"
              className="w-full h-[50vh] min-h-[320px] md:h-[60vh] border-0"
            />
          </div>
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-blue-400 hover:text-blue-300 mt-2 transition-colors"
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open in Google Maps
          </a>
        </DialogContent>
      </Dialog>
    </div>
  );
};
