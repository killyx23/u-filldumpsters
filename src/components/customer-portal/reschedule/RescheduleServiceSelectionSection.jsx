import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Info, Star, Package, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { ServiceDescriptionModal } from './ServiceDescriptionModal';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';
import { useServiceScheduleDescription } from '@/hooks/useServiceScheduleDescription';
import { fetchTemporaryServiceAvailabilityMap } from '@/utils/temporaryServiceAvailability';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

const ServiceCardDescription = ({ service, referenceDate }) => {
    const { description, loading } = useServiceScheduleDescription(service, referenceDate, true);

    if (loading) {
        return <p className="text-sm text-gray-500 leading-relaxed mb-6 line-clamp-3 pr-2">Loading schedule...</p>;
    }

    return (
        <p className="text-sm text-gray-400 leading-relaxed mb-6 line-clamp-3 pr-2">
            {description}
        </p>
    );
};

export const RescheduleServiceSelectionSection = ({
    currentServiceId,
    selectedService,
    onSelectService,
    availableServices = [],
    referenceDate = null,
}) => {
    const navigate = useNavigate();
    const handleSelectService = onSelectService || (() => {
        console.warn('RescheduleServiceSelectionSection: onSelectService callback not provided');
    });

    const [infoModalService, setInfoModalService] = useState(null);
    const [availability, setAvailability] = useState({});
    const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
    const [unavailableDialogService, setUnavailableDialogService] = useState(null);
    const clearedUnavailableRef = useRef(null);

    const serviceIdsKey = useMemo(
        () => (availableServices || []).map((s) => s?.id).filter((id) => id != null).join(','),
        [availableServices]
    );

    useEffect(() => {
        let cancelled = false;

        const loadAvailability = async () => {
            setAvailabilityLoaded(false);
            const map = await fetchTemporaryServiceAvailabilityMap(availableServices || []);
            if (cancelled) return;
            setAvailability(map);
            setAvailabilityLoaded(true);
        };

        if (serviceIdsKey) {
            loadAvailability();
        } else {
            setAvailability({});
            setAvailabilityLoaded(true);
        }

        return () => {
            cancelled = true;
        };
        // availableServices identity can change; serviceIdsKey is the stable signal
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serviceIdsKey]);

    useEffect(() => {
        if (!availabilityLoaded || !selectedService?.id) return;
        if (availability[selectedService.id] !== false) return;
        if (clearedUnavailableRef.current === selectedService.id) return;

        clearedUnavailableRef.current = selectedService.id;
        handleSelectService(null);
    }, [availabilityLoaded, availability, selectedService, handleSelectService]);

    const handleCardClick = (service) => {
        if (availability[service?.id] === false) {
            setUnavailableDialogService(service);
            return;
        }
        if (handleSelectService && typeof handleSelectService === 'function') {
            handleSelectService(service);
        }
    };

    const handleContact = () => {
        setUnavailableDialogService(null);
        navigate('/contact');
    };

    const unavailableName = safeExtractString(
        unavailableDialogService?.name,
        'selected service'
    );

    return (
        <div className="w-full max-w-5xl mx-auto animate-in fade-in duration-500 space-y-8">
            <div className="text-center space-y-3 pb-4">
                <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    Select Your Service Level
                </h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">
                    Choose the best option for your new dates. You can maintain your current service or upgrade your experience.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {availableServices?.map((service, idx) => {
                    const safeId = service?.id || `service-${idx}`;
                    const isTemporarilyUnavailable = availability[service?.id] === false;
                    const isSelected = !isTemporarilyUnavailable && selectedService?.id === service?.id;
                    const isCurrent = currentServiceId === service?.id;

                    const serviceName = safeExtractString(service?.name, 'Standard Service');
                    const basePrice = safeExtractNumber(service?.base_price, 0);
                    const priceUnit = safeExtractString(service?.price_unit, '');

                    return (
                        <div
                            key={safeId}
                            className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-300 overflow-hidden cursor-pointer group
                                ${isTemporarilyUnavailable
                                    ? 'bg-gray-900/70 border-gray-800 opacity-70'
                                    : isSelected
                                        ? 'bg-[hsl(var(--gold)_/_0.08)] border-gold shadow-[0_0_30px_hsla(var(--gold),0.15)] scale-[1.02]'
                                        : 'bg-gray-900 border-gray-800 hover:border-gold/50 hover:bg-gray-800/80 hover:shadow-xl'
                                }
                            `}
                            onClick={() => handleCardClick(service)}
                        >
                            {isTemporarilyUnavailable && (
                                <div className="absolute top-0 left-0 bg-gray-800/95 backdrop-blur-md text-gray-200 text-[10px] font-black px-4 py-1.5 rounded-br-xl z-10 flex items-center border-b border-r border-gray-700 shadow-sm tracking-wide uppercase">
                                    Temporarily Unavailable
                                </div>
                            )}

                            {isCurrent && (
                                <div className="absolute top-0 right-0 bg-gray-800/90 backdrop-blur-md text-white text-[10px] font-black px-4 py-1.5 rounded-bl-xl z-10 flex items-center border-b border-l border-gray-700 shadow-sm">
                                    <Star className="w-3.5 h-3.5 mr-1.5 text-gold fill-gold" /> CURRENT
                                </div>
                            )}

                            {isSelected && (
                                <div className="absolute top-5 right-5 text-gold z-10 bg-gray-950/80 rounded-full p-0 shadow-gold animate-in zoom-in duration-300">
                                    <CheckCircle className="h-7 w-7" />
                                </div>
                            )}

                            <div className="mb-6">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border transition-colors shadow-sm
                                    ${isTemporarilyUnavailable
                                        ? 'bg-gray-950 border-gray-800 text-gray-600'
                                        : isSelected
                                            ? 'bg-[hsl(var(--gold)_/_0.15)] border-gold/40 text-gold'
                                            : 'bg-gray-950 border-gray-800 text-gray-400 group-hover:text-gray-200'}`}>
                                    <Package className="w-8 h-8" />
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-3 gap-2">
                                    <h4 className={`font-extrabold text-xl leading-tight transition-colors ${
                                        isTemporarilyUnavailable
                                            ? 'text-gray-400'
                                            : isSelected
                                                ? 'text-gold-light'
                                                : 'text-white group-hover:text-gray-100'
                                    }`}>
                                        {serviceName}
                                    </h4>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setInfoModalService(service); }}
                                        className="p-2 rounded-full bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-gold transition-colors z-20 relative flex-shrink-0"
                                        title="View full details"
                                    >
                                        <Info className="w-5 h-5" />
                                    </button>
                                </div>

                                <ServiceCardDescription service={service} referenceDate={referenceDate} />

                                <div className="mt-auto pt-5 border-t border-gray-800/60">
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-gray-500 uppercase tracking-widest font-bold">Base Rate</span>
                                        <span className={`text-2xl font-black tracking-tight ${
                                            isTemporarilyUnavailable
                                                ? 'text-gray-500'
                                                : isSelected
                                                    ? 'text-gold drop-shadow-sm'
                                                    : 'text-white'
                                        }`}>
                                            {formatCurrency(basePrice * 100, { code: 'USD', symbol: '$' })}
                                            {priceUnit ? (
                                                <span className="text-sm font-semibold text-gray-400 ml-1">{priceUnit}</span>
                                            ) : null}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <ServiceDescriptionModal
                service={infoModalService}
                isOpen={!!infoModalService}
                onClose={() => setInfoModalService(null)}
                referenceDate={referenceDate}
            />

            <Dialog
                open={!!unavailableDialogService}
                onOpenChange={(open) => {
                    if (!open) setUnavailableDialogService(null);
                }}
            >
                <DialogContent className="bg-gray-900 border-gold/60 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center text-2xl text-gold">
                            <AlertTriangle className="mr-3 h-8 w-8 flex-shrink-0" />
                            Service Temporarily Unavailable
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription asChild>
                        <div className="my-4 text-base text-gray-300 space-y-4">
                            <p>
                                We apologize for the inconvenience. The{' '}
                                <strong className="text-white">{unavailableName}</strong> is temporarily unavailable,
                                and we are working to have it available again soon. Please check back here often.
                            </p>
                            <p>
                                If you need this service and are willing to work with us, or your timeline is flexible
                                and you do not need it right away, we may still be able to fit you in. Please contact
                                our customer service team to discuss options.
                            </p>
                        </div>
                    </DialogDescription>
                    <DialogFooter className="sm:justify-between gap-2 mt-4">
                        <Button
                            onClick={() => setUnavailableDialogService(null)}
                            variant="outline"
                            className="text-white border-white/50 hover:bg-white/20"
                        >
                            See You Soon
                        </Button>
                        <Button onClick={handleContact} className="bg-gold hover:bg-gold-light text-black">
                            Contact Us
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
