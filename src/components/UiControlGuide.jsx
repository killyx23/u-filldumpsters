import React, { useMemo, useState } from 'react';
import { HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Discreet icon / control legend for booking steps and customer portal.
 * variant="full" — booking journey (carousel when many entries)
 * variant="compact" — portal (scroll list, fewer entries)
 */
export const UiControlGuide = ({
  entries = [],
  stepTitle = 'This page',
  variant = 'full',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleEntries = useMemo(
    () => entries.filter((e) => e.visible !== false),
    [entries]
  );

  if (visibleEntries.length === 0) return null;

  const isCompact = variant === 'compact';
  const label = isCompact ? 'Quick icon help' : 'Icon guide';
  const previewCount = isCompact ? 2 : 4;
  const previewEntries = visibleEntries.slice(0, previewCount);
  const useCarousel = !isCompact && visibleEntries.length > 4;
  const activeEntry = visibleEntries[activeIndex] ?? visibleEntries[0];

  const openDialog = () => {
    setActiveIndex(0);
    setOpen(true);
  };

  const goPrev = () => setActiveIndex((i) => (i <= 0 ? visibleEntries.length - 1 : i - 1));
  const goNext = () => setActiveIndex((i) => (i >= visibleEntries.length - 1 ? 0 : i + 1));

  const renderEntryIcon = (entry, sizeClass = 'h-4 w-4') => {
    const Icon = entry.icon;
    if (!Icon) return null;
    return <Icon className={`${sizeClass} shrink-0 ${entry.iconClassName ?? ''}`} aria-hidden />;
  };

  return (
    <>
      <div className={`${className}`}>
        <button
          type="button"
          onClick={openDialog}
          aria-expanded={open}
          aria-label={`Open ${label} for ${stepTitle}`}
          className={`inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 text-left transition-colors hover:bg-black/30 tap-target ${
            isCompact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
          }`}
        >
          <HelpCircle
            className={`shrink-0 text-blue-300 animate-pulse-glow ${
              isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'
            }`}
            aria-hidden
          />
          <span className="font-medium text-blue-200">{label}</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 border-l border-white/10 pl-2 ml-0.5">
            {previewEntries.map((entry) => (
              <span key={entry.id} className="opacity-80" title={entry.shortLabel}>
                {renderEntryIcon(entry, isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')}
              </span>
            ))}
          </span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-yellow-400 text-lg flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              {label} — {stepTitle}
            </DialogTitle>
            <DialogDescription className="text-blue-200/90 text-sm">
              Tap or click highlighted icons on this page for more detail. This guide explains what they mean.
            </DialogDescription>
          </DialogHeader>

          {useCarousel ? (
            <div className="py-2 space-y-4 flex-1 overflow-y-auto">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="mt-0.5 p-2 rounded-full bg-black/30">
                  {renderEntryIcon(activeEntry, 'h-6 w-6')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{activeEntry.shortLabel}</p>
                  <p className="text-sm text-blue-100 mt-2">{activeEntry.description}</p>
                  <p className="text-sm text-yellow-200/90 mt-2 italic">
                    <span className="font-medium not-italic text-yellow-400">How to use: </span>
                    {activeEntry.howToUse}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                <Button type="button" variant="ghost" size="sm" onClick={goPrev} className="text-blue-200">
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <span>
                  {activeIndex + 1} of {visibleEntries.length}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={goNext} className="text-blue-200">
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-2 space-y-3 flex-1 overflow-y-auto max-h-[50vh] pr-1">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="mt-0.5 p-1.5 rounded-full bg-black/30 shrink-0">
                    {renderEntryIcon(entry, isCompact ? 'h-4 w-4' : 'h-5 w-5')}
                  </div>
                  <div className="min-w-0">
                    <p className={`font-semibold text-white ${isCompact ? 'text-sm' : ''}`}>
                      {entry.shortLabel}
                    </p>
                    <p className={`text-blue-100 mt-1 ${isCompact ? 'text-xs' : 'text-sm'}`}>
                      {entry.description}
                    </p>
                    {!isCompact && (
                      <p className="text-xs text-yellow-200/90 mt-1.5">
                        <span className="font-medium text-yellow-400">How to use: </span>
                        {entry.howToUse}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              className="bg-yellow-500 hover:bg-yellow-600 text-black w-full sm:w-auto"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
