import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    addDays,
    format,
    startOfWeek,
} from 'date-fns';
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Clock,
    Mail,
    MapPin,
    Phone,
    Truck,
    User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { getHeroImageForService, siteImages } from '@/config/siteImages';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';
import { formatAddressDisplay } from '@/utils/addressHelpers';
import { formatMilesLabel, resolveOneWayMiles } from '@/utils/bookingMileage';
import { getBookingWindow } from '@/utils/pinTiming';
import { convertTo12Hour } from '@/utils/timeFormatConverter';

const INACTIVE_STATUSES = new Set([
    'Cancelled',
    'cancelled',
    'pending_payment',
    'booking_not_finished',
]);

function localDateFromKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function toDateKey(date) {
    return format(date, 'yyyy-MM-dd');
}

function bookingDateKey(value) {
    if (!value) return '';
    return String(value).slice(0, 10);
}

function formatRemaining(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    const seconds = totalSec % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function equipmentImage(plan) {
    const id = Number(plan?.id);
    return getHeroImageForService(id)
        || (id === 4 ? siteImages.showcaseDumpster : '')
        || (id === 8 ? siteImages.diyHeavyEquipment : '')
        || siteImages.logo;
}

function customerName(booking) {
    const customer = booking.customers || {};
    const fromParts = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
    return customer.name || fromParts || booking.name || 'Customer';
}

function jobSite(booking) {
    return formatAddressDisplay(booking.delivery_address)
        || [booking.street, booking.city, booking.state, booking.zip].filter(Boolean).join(', ')
        || 'No job site on file';
}

function contactPhone(booking) {
    return booking.customers?.phone || booking.phone || '';
}

function contactEmail(booking) {
    return booking.customers?.email || booking.email || '';
}

function timeLabel(slot) {
    if (!slot) return 'Time not set';
    return convertTo12Hour(slot) || slot;
}

function actionForBooking(booking, dateKey) {
    const pickupService = isCustomerPickupService(booking.plan, booking.addons || {});
    const actions = [];

    if (bookingDateKey(booking.drop_off_date) === dateKey) {
        actions.push(pickupService
            ? {
                key: 'customer_pickup',
                label: 'Customer pickup',
                countdownLabel: 'Until they pick it up',
                done: Boolean(booking.rented_out_at),
                doneAt: booking.rented_out_at,
                when: timeLabel(booking.drop_off_time_slot),
                target: 'start',
            }
            : {
                key: 'delivery',
                label: 'Delivery',
                countdownLabel: 'Until delivery',
                done: Boolean(booking.delivered_at),
                doneAt: booking.delivered_at,
                when: timeLabel(booking.drop_off_time_slot),
                target: 'start',
            });
    }

    if (bookingDateKey(booking.pickup_date) === dateKey) {
        actions.push(pickupService
            ? {
                key: 'return',
                label: 'Return',
                countdownLabel: 'Until they return it',
                done: Boolean(booking.returned_at),
                doneAt: booking.returned_at,
                when: timeLabel(booking.pickup_time_slot),
                target: 'end',
            }
            : {
                key: 'pickup',
                label: 'Pickup',
                countdownLabel: 'Until we pick it up',
                done: Boolean(booking.picked_up_at),
                doneAt: booking.picked_up_at,
                when: timeLabel(booking.pickup_time_slot),
                target: 'end',
            });
    }

    return actions;
}

function targetMs(booking, action) {
    const window = getBookingWindow(booking);
    return action.target === 'end' ? window.endMs : window.startMs;
}

function addonLines(addons) {
    if (!addons || typeof addons !== 'object') return [];
    const skip = new Set([
        'deliveryService',
        'isDelivery',
        'distanceInfo',
        'loyaltyPointsEarned',
        'loyaltyPointsReversedOnCancel',
        'loyaltyPointsToRedeem',
        'referralDollarsPending',
        'referralDollarsToRedeem',
        'oneWayDistanceMiles',
        'mileageCharge',
        'deliveryFee',
    ]);
    const lines = [];
    Object.entries(addons).forEach(([key, value]) => {
        if (skip.has(key) || value == null || value === false || value === '' || value === 0) return;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim();
        if (value === true) lines.push(label);
        else if (typeof value === 'string' || typeof value === 'number') lines.push(`${label}: ${value}`);
    });
    return lines.slice(0, 8);
}

function inventoryLines(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => {
            if (typeof item === 'string') return item;
            return item?.name || item?.label || item?.equipment_name || null;
        })
        .filter(Boolean);
}

const tone = {
    delivery: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
    pickup: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
    customer_pickup: 'bg-violet-500/20 text-violet-200 border-violet-400/40',
    return: 'bg-orange-500/20 text-orange-200 border-orange-400/40',
};

function DayStopCard({ booking, action, nowMs, onOpen }) {
    const ms = targetMs(booking, action);
    const remaining = Number.isFinite(ms) ? ms - nowMs : NaN;
    const overdue = !action.done && Number.isFinite(remaining) && remaining < 0;
    const customer = booking.customers || {};
    const phone = contactPhone(booking);
    const email = contactEmail(booking);
    const miles = formatMilesLabel(resolveOneWayMiles(booking, customer));
    const addons = addonLines(booking.addons);
    const inventory = inventoryLines(booking.assigned_inventory_items);
    const price = Number(booking.total_price);
    const image = equipmentImage(booking.plan);

    return (
        <article className="overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-lg">
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
                <div className="relative min-h-[180px] bg-black/40">
                    <img
                        src={image}
                        alt={formatCustomerFacingPlanName(booking.plan?.name) || 'Equipment'}
                        className="h-full w-full object-cover"
                        onError={(event) => {
                            event.currentTarget.src = siteImages.logo;
                        }}
                    />
                    <span className={`absolute left-3 top-3 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${tone[action.key]}`}>
                        {action.label}
                    </span>
                </div>
                <div className="p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-xl font-bold text-white">{customerName(booking)}</h3>
                            <p className="text-sm text-blue-200">
                                Booking #{booking.id} · {formatCustomerFacingPlanName(booking.plan?.name) || 'Service'}
                            </p>
                        </div>
                        <div className="text-right">
                            <StatusBadge status={booking.status} booking={booking} />
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-yellow-400/80">
                                {action.done ? 'Finished' : action.countdownLabel}
                            </p>
                            <p className={`text-lg font-bold tabular-nums ${overdue ? 'text-red-300' : 'text-yellow-300'}`}>
                                {action.done
                                    ? (action.doneAt ? format(new Date(action.doneAt), 'h:mm a') : 'Done')
                                    : overdue
                                        ? `${formatRemaining(-remaining)} overdue`
                                        : (Number.isFinite(remaining) ? formatRemaining(remaining) : 'Time not set')}
                            </p>
                            <p className="text-sm text-gray-300">Scheduled {action.when}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <Info icon={<Phone className="h-4 w-4" />} label="Phone">
                            {phone ? <a className="hover:underline" href={`tel:${phone}`}>{phone}</a> : 'No phone'}
                        </Info>
                        <Info icon={<Mail className="h-4 w-4" />} label="Email">
                            {email ? <a className="hover:underline break-all" href={`mailto:${email}`}>{email}</a> : 'No email'}
                        </Info>
                        <Info icon={<MapPin className="h-4 w-4" />} label="Job site">
                            {jobSite(booking)}
                        </Info>
                        <Info icon={<Clock className="h-4 w-4" />} label="Other stop">
                            {action.target === 'start'
                                ? `Pickup ${bookingDateKey(booking.pickup_date) || '—'} · ${timeLabel(booking.pickup_time_slot)}`
                                : `Drop-off ${bookingDateKey(booking.drop_off_date) || '—'} · ${timeLabel(booking.drop_off_time_slot)}`}
                        </Info>
                        <Info icon={<Truck className="h-4 w-4" />} label="Drive">
                            {miles} one way
                            {customer.travel_time_minutes ? ` · about ${customer.travel_time_minutes} min` : ''}
                        </Info>
                        <Info icon={<User className="h-4 w-4" />} label="Order">
                            {Number.isFinite(price) ? `$${price.toFixed(2)}` : 'Price not set'}
                            {booking.license_plate || customer.license_plate
                                ? ` · Plate ${booking.license_plate || customer.license_plate}`
                                : ''}
                        </Info>
                    </div>

                    {inventory.length > 0 && (
                        <p className="text-sm text-gray-200">
                            <span className="font-semibold text-yellow-400">Equipment: </span>
                            {inventory.join(', ')}
                        </p>
                    )}
                    {addons.length > 0 && (
                        <p className="text-sm text-gray-200">
                            <span className="font-semibold text-yellow-400">Add-ons: </span>
                            {addons.join(' · ')}
                        </p>
                    )}
                    {booking.notes && (
                        <p className="text-sm text-gray-200 whitespace-pre-wrap">
                            <span className="font-semibold text-yellow-400">Notes: </span>
                            {booking.notes}
                        </p>
                    )}

                    <Button
                        size="sm"
                        variant="outline"
                        className="border-white/30 text-white"
                        onClick={() => onOpen(booking)}
                    >
                        Open customer
                    </Button>
                </div>
            </div>
        </article>
    );
}

function Info({ icon, label, children }) {
    return (
        <div className="flex gap-2 rounded-lg bg-black/20 px-3 py-2">
            <span className="mt-0.5 text-yellow-400">{icon}</span>
            <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
                <p className="text-white">{children}</p>
            </div>
        </div>
    );
}

export function ThingsForTheDay({ bookings = [] }) {
    const navigate = useNavigate();
    const [selected, setSelected] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    });
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const id = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    const activeBookings = useMemo(
        () => bookings.filter((booking) => booking?.drop_off_date && !INACTIVE_STATUSES.has(booking.status)),
        [bookings],
    );

    const selectedKey = toDateKey(selected);
    const weekStart = startOfWeek(selected, { weekStartsOn: 0 });
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

    const stops = useMemo(() => {
        const rows = [];
        activeBookings.forEach((booking) => {
            actionForBooking(booking, selectedKey).forEach((action) => {
                rows.push({ booking, action });
            });
        });
        rows.sort((a, b) => {
            const aMs = targetMs(a.booking, a.action);
            const bMs = targetMs(b.booking, b.action);
            if (!Number.isFinite(aMs)) return 1;
            if (!Number.isFinite(bMs)) return -1;
            return aMs - bMs;
        });
        return rows;
    }, [activeBookings, selectedKey]);

    const weekCounts = useMemo(() => {
        const counts = {};
        weekDays.forEach((day) => {
            const key = toDateKey(day);
            let deliveries = 0;
            let pickups = 0;
            activeBookings.forEach((booking) => {
                actionForBooking(booking, key).forEach((action) => {
                    if (action.key === 'delivery' || action.key === 'customer_pickup') deliveries += 1;
                    else pickups += 1;
                });
            });
            counts[key] = { deliveries, pickups, total: deliveries + pickups };
        });
        return counts;
    }, [activeBookings, weekDays]);

    const deliveryCount = stops.filter((stop) => stop.action.key === 'delivery' || stop.action.key === 'customer_pickup').length;
    const pickupCount = stops.length - deliveryCount;
    const todayKey = toDateKey(new Date());

    const openCustomer = (booking) => {
        if (!booking.customer_id) return;
        navigate(`/admin/customer/${booking.customer_id}?tab=history`);
    };

    return (
        <section className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-yellow-400">Things for the Day</h2>
                    <p className="text-blue-200">
                        {format(selected, 'EEEE, MMMM d, yyyy')}
                        {' · '}
                        {stops.length === 0
                            ? 'Nothing scheduled'
                            : `${stops.length} stop${stops.length === 1 ? '' : 's'} · ${deliveryCount} out · ${pickupCount} back`}
                    </p>
                </div>
                <Button
                    variant="outline"
                    className="border-white/30 text-white"
                    onClick={() => {
                        const now = new Date();
                        setSelected(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
                    }}
                >
                    Today
                </Button>
            </div>

            {stops.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-12 text-center text-blue-200">
                    No deliveries or pickups on this day. Pick another day on the week below.
                </div>
            ) : (
                <div className="space-y-4">
                    {stops.map(({ booking, action }) => (
                        <DayStopCard
                            key={`${booking.id}-${action.key}`}
                            booking={booking}
                            action={action}
                            nowMs={nowMs}
                            onOpen={openCustomer}
                        />
                    ))}
                </div>
            )}

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-yellow-400">
                        <CalendarDays className="h-5 w-5" />
                        <h3 className="text-lg font-bold">This week</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="icon"
                            variant="outline"
                            className="border-white/30 text-white"
                            aria-label="Previous week"
                            onClick={() => setSelected((current) => addDays(current, -7))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="min-w-[10rem] text-center text-sm text-gray-200">
                            {format(weekDays[0], 'MMM d')} – {format(weekDays[6], 'MMM d')}
                        </span>
                        <Button
                            size="icon"
                            variant="outline"
                            className="border-white/30 text-white"
                            aria-label="Next week"
                            onClick={() => setSelected((current) => addDays(current, 7))}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {weekDays.map((day) => {
                        const key = toDateKey(day);
                        const count = weekCounts[key] || { deliveries: 0, pickups: 0, total: 0 };
                        const isSelected = key === selectedKey;
                        const isToday = key === todayKey;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setSelected(localDateFromKey(key))}
                                className={`rounded-lg border px-2 py-3 text-left transition-colors ${
                                    isSelected
                                        ? 'border-yellow-400 bg-yellow-400/15'
                                        : 'border-white/10 bg-black/20 hover:bg-white/10'
                                }`}
                            >
                                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                                    {format(day, 'EEE')}
                                    {isToday ? ' · Today' : ''}
                                </p>
                                <p className="text-2xl font-bold text-white">{format(day, 'd')}</p>
                                <p className="mt-1 text-xs text-cyan-200">{count.deliveries} out</p>
                                <p className="text-xs text-amber-200">{count.pickups} back</p>
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
