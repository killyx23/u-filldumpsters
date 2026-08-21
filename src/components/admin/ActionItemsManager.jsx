import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, MessageSquare } from 'lucide-react';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { ResolveFollowUpDialog } from '@/components/admin/ResolveFollowUpDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { getFollowUpReasonLabel, isFollowUpHold } from '@/utils/followUpResolution';
import { hasPaymentDelta, isActionItemVerificationBooking } from '@/utils/paymentDelta';

const ActionItemCard = ({ title, icon, items, onCardClick, emptyText }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg cursor-pointer hover:bg-white/10 transition-colors" onClick={() => onCardClick(title, items)}>
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
                {icon}
                <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
            </div>
            {items.length > 0 && (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-base font-bold text-white">
                    {items.length}
                </span>
            )}
        </div>
        <p className="text-blue-200 text-sm">
            {items.length > 0 ? `${items.length} item(s) require attention. Click to view.` : emptyText}
        </p>
    </div>
);

const ActionItemsDialog = ({ isOpen, onOpenChange, title, items, onNavigate, onResolveFlagged }) => {
    const getDetails = (item) => {
        switch (item.type) {
            case 'verification': {
                if (item.status === 'pending_payment' && hasPaymentDelta(item)) {
                    return `Booking #${item.id} for ${item.customers?.name || 'N/A'} has a pending payment adjustment.`;
                }
                if (item.reschedule_history && item.reschedule_history.length > 0) {
                    return `Booking #${item.id} for ${item.customers?.name || 'N/A'} is pending Reschedule Request.`;
                }
                if (item.was_verification_skipped) {
                    return `Booking #${item.id} for ${item.customers?.name || 'N/A'} is pending Initial Verification.`;
                }
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'} is pending verification review.`;
            }
            case 'flagged': {
                const hold = isFollowUpHold(item.follow_up_resolution);
                if (hold) {
                    return `Booking #${item.id} for ${item.customers?.name || 'N/A'}: repair before next rental${item.follow_up_resolution?.reason ? ` — ${getFollowUpReasonLabel(item.follow_up_resolution.reason)}` : ''}.`;
                }
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'} was flagged for follow-up.`;
            }
            case 'cancellation':
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'}: Cancellation request pending review.`;
            case 'payment':
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'} is pending payment.`;
            case 'unread_notes':
                return `Customer ${item.name} has unread messages.`;
            default:
                return 'Unknown action item.';
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-yellow-400">{title}</DialogTitle>
                    <DialogDescription>
                        {title === 'Flagged for Follow-up'
                            ? 'Resolve a flag here, or open the customer History tab.'
                            : 'Click an item to navigate to the customer\'s file.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto space-y-3 p-1 pr-4">
                    {items.length > 0 ? items.map(item => (
                        <div
                            key={`${item.type}-${item.id}`}
                            className="bg-white/10 p-4 rounded-md"
                        >
                            <p className="font-semibold text-white">{getDetails(item)}</p>
                            {item.status && (
                                <div className="mt-1">
                                    <StatusBadge status={item.status} booking={item} />
                                </div>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                                {item.type === 'flagged' && (
                                    <Button
                                        size="sm"
                                        className={isFollowUpHold(item.follow_up_resolution) ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onResolveFlagged?.(item);
                                        }}
                                    >
                                        {isFollowUpHold(item.follow_up_resolution) ? 'Update / Close Follow-up' : 'Resolve Follow-up'}
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-white/30 text-white"
                                    onClick={() => onNavigate(item)}
                                >
                                    Open customer
                                </Button>
                            </div>
                        </div>
                    )) : (
                        <p className="text-center text-blue-200 py-8">No items require action in this category.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const ActionItemsManager = ({ bookings, customersWithUnreadNotes, onUpdate }) => {
    const navigate = useNavigate();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogContent, setDialogContent] = useState({ title: '', items: [] });
    const [resolveBooking, setResolveBooking] = useState(null);

    const flaggedForFollowUp = bookings
        ? bookings
            .filter(b => b.status === 'flagged' || b.status === 'cancellation_pending')
            .map(b => ({ ...b, type: b.status === 'cancellation_pending' ? 'cancellation' : 'flagged' }))
        : [];
    const pendingVerification = bookings
        ? bookings
            .filter(isActionItemVerificationBooking)
            .map(b => ({ ...b, type: 'verification' }))
        : [];
    const unreadNotesItems = customersWithUnreadNotes
        ? customersWithUnreadNotes.map(c => ({ ...c, type: 'unread_notes' }))
        : [];

    const handleCardClick = (title, items) => {
        setDialogContent({ title, items });
        setDialogOpen(true);
    };

    const handleNavigate = (item) => {
        if (!item) return;
        const targetCustomerId = item.type === 'unread_notes' ? item.id : item.customer_id;

        if (!targetCustomerId) return;

        let tab = 'profile';
        if (item.type === 'verification') tab = 'verification';
        if (item.type === 'flagged') tab = 'history';
        if (item.type === 'cancellation') tab = 'verification';
        if (item.type === 'unread_notes') tab = 'notes';

        navigate(`/admin/customer/${targetCustomerId}?tab=${tab}`);
        setDialogOpen(false);
    };

    const handleResolved = () => {
        setResolveBooking(null);
        setDialogOpen(false);
        onUpdate?.();
    };

    return (
        <>
            <ResolveFollowUpDialog
                open={!!resolveBooking}
                onOpenChange={(isOpen) => {
                    if (!isOpen) setResolveBooking(null);
                }}
                booking={resolveBooking}
                onResolved={handleResolved}
            />
            <ActionItemsDialog
                isOpen={dialogOpen}
                onOpenChange={setDialogOpen}
                title={dialogContent.title}
                items={dialogContent.items}
                onNavigate={handleNavigate}
                onResolveFlagged={(item) => {
                    setDialogOpen(false);
                    setResolveBooking(item);
                }}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <ActionItemCard
                    title="Pending Verification"
                    icon={<ShieldAlert className="h-6 w-6 text-orange-400" />}
                    items={pendingVerification}
                    onCardClick={handleCardClick}
                    emptyText="No bookings pending verification."
                />
                <ActionItemCard
                    title="Unread Messages"
                    icon={<MessageSquare className="h-6 w-6 text-blue-400" />}
                    items={unreadNotesItems}
                    onCardClick={handleCardClick}
                    emptyText="All customer messages have been read."
                />
                <ActionItemCard
                    title="Flagged for Follow-up"
                    icon={<AlertTriangle className="h-6 w-6 text-red-400" />}
                    items={flaggedForFollowUp}
                    onCardClick={handleCardClick}
                    emptyText="No bookings are flagged."
                />
            </div>
        </>
    );
};
