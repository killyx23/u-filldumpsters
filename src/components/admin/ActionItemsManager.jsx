import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, DollarSign, ShieldAlert, MessageSquare, X } from 'lucide-react';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';

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

const ActionItemsDialog = ({ isOpen, onOpenChange, title, items, onNavigate }) => {
    const getDetails = (item) => {
        switch (item.type) {
            case 'verification':
                const reason = (item.reschedule_history && item.reschedule_history.length > 0) ? 'Reschedule Request' : 'Initial Verification';
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'} is pending ${reason}.`;
            case 'flagged':
                return `Booking #${item.id} for ${item.customers?.name || 'N/A'} was flagged for follow-up.`;
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
                    <DialogDescription>Click an item to navigate to the customer's file.</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto space-y-3 p-1 pr-4">
                    {items.length > 0 ? items.map(item => (
                        <div 
                            key={`${item.type}-${item.id}`} 
                            onClick={() => onNavigate(item)}
                            className="bg-white/10 p-4 rounded-md cursor-pointer hover:bg-white/20 transition-colors"
                        >
                            <p className="font-semibold text-white">{getDetails(item)}</p>
                            {item.status && <div className="mt-1"><StatusBadge status={item.status} /></div>}
                        </div>
                    )) : (
                        <p className="text-center text-blue-200 py-8">No items require action in this category.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const ActionItemsManager = ({ bookings, customersWithUnreadNotes }) => {
    const navigate = useNavigate();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogContent, setDialogContent] = useState({ title: '', items: [] });

    // Log the bookings prop to check if it's passed correctly
    console.log('Bookings:', bookings);

    // Log the status of each booking to verify they match expected status values
    bookings?.forEach(b => console.log('Booking status:', b.status));

    // Filter for flagged bookings
    const flaggedForFollowUp = bookings ? bookings.filter(b => b.status === 'flagged').map(b => ({ ...b, type: 'flagged' })) : [];
    console.log('Flagged for Follow Up:', flaggedForFollowUp);

    // Filter for pending verification
    const pendingVerification = bookings ? bookings.filter(b => ['pending_verification', 'pending_review', 'pending_payment'].includes(b.status)).map(b => ({ ...b, type: 'verification' })) : [];
    console.log('Pending Verification:', pendingVerification);  // Log the filtered array here

    // Filter for unread notes items
    const unreadNotesItems = customersWithUnreadNotes ? customersWithUnreadNotes.map(c => ({ ...c, type: 'unread_notes' })) : [];
    console.log('Unread Notes Items:', unreadNotesItems);

    const handleCardClick = (title, items) => {
        setDialogContent({ title, items });
        setDialogOpen(true);
    };

    const handleNavigate = (item) => {
        if (!item || !item.customer_id && !item.id) return;
        const customerId = item.customer_id || item.id;
        let tab = 'profile';
        if (item.type === 'verification') tab = 'verification';
        if (item.type === 'flagged') tab = 'rentals';
        if (item.type === 'unread_notes') tab = 'notes';
        
        navigate(`/admin/customer/${customerId}?tab=${tab}`);
        setDialogOpen(false);
    };

    return (
        <>
            <ActionItemsDialog 
                isOpen={dialogOpen}
                onOpenChange={setDialogOpen}
                title={dialogContent.title}
                items={dialogContent.items}
                onNavigate={handleNavigate}
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