import React from 'react';
import { format, parseISO } from 'date-fns';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { CheckCircle, Clock, DollarSign, Package, AlertTriangle, Image, Paperclip, XCircle } from 'lucide-react';

const DetailItem = ({ icon, label, value, className = '' }) => (
    <div className={`flex items-start space-x-3 ${className}`}>
        <div className="flex-shrink-0 h-6 w-6 text-yellow-400">{icon}</div>
        <div>
            <p className="text-sm font-semibold text-blue-200">{label}</p>
            <p className="text-base font-bold text-white break-all">{value}</p>
        </div>
    </div>
);

const IssueItem = ({ title, details }) => (
    <div className="bg-red-900/30 border border-red-500/50 p-3 rounded-md">
        <p className="font-bold text-red-300">{title}</p>
        <p className="text-sm text-red-200">{details}</p>
    </div>
);

export const CompletedBookings = ({ bookings, equipment }) => {
    if (!bookings || bookings.length === 0) return null;

    return (
        <div className="space-y-8">
            <h3 className="text-2xl font-bold text-yellow-400">Completed & Cancelled Rentals</h3>
            {bookings.map(booking => {
                 const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);
                 const returnIssues = booking.return_issues || {};
                 const fees = booking.fees || {};
                 const refundDetails = booking.refund_details || null;

                 return (
                    <div key={booking.id} className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h4 className="text-xl font-bold text-white">{booking.plan.name}</h4>
                                <p className="text-sm text-blue-200">Booked on {format(parseISO(booking.created_at), 'PPP')}</p>
                            </div>
                            <StatusBadge status={booking.status} />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <DetailItem icon={<Clock />} label="Start Date" value={format(parseISO(booking.drop_off_date), 'PPP')} />
                             <DetailItem icon={<Clock />} label="End Date" value={format(parseISO(booking.pickup_date), 'PPP')} />
                             <DetailItem icon={<DollarSign />} label="Final Price" value={`$${booking.total_price.toFixed(2)}`} />
                             
                             {booking.returned_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Returned On" value={format(parseISO(booking.returned_at), 'Pp')} />}
                             {booking.picked_up_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
                        </div>

                        {relevantEquipment.length > 0 && (
                            <div className="mt-4">
                                <p className="font-semibold text-blue-100">Equipment Included:</p>
                                <ul className="list-disc list-inside text-white pl-4">
                                    {relevantEquipment.map(e => <li key={e.id}>{e.equipment.name} (x{e.quantity})</li>)}
                                </ul>
                            </div>
                        )}

                        {refundDetails && (
                            <div className="mt-4 border-t border-red-400/50 pt-4 space-y-2">
                                <h5 className="font-bold text-red-300 flex items-center"><XCircle className="mr-2 h-5 w-5" />Cancellation & Refund Details</h5>
                                <p className="text-red-200"><strong>Reason:</strong> {refundDetails.reason}</p>
                                <p className="text-red-200"><strong>Amount Refunded:</strong> <span className="font-bold">${refundDetails.amount.toFixed(2)}</span></p>
                                <p className="text-xs text-gray-400">Refund ID: {refundDetails.refund_id}</p>
                            </div>
                        )}
                        
                        {Object.keys(returnIssues).length > 0 && (
                            <div className="mt-4 border-t border-white/20 pt-4 space-y-2">
                                <h5 className="font-bold text-orange-400 flex items-center"><AlertTriangle className="mr-2 h-5 w-5" />Issues Logged</h5>
                                {Object.entries(returnIssues).map(([key, value]) => {
                                    if (value.status === 'not_returned') return <IssueItem key={key} title={`Unreturned Item: ${key}`} details="Customer was charged for this item." />;
                                    if (value.status === 'not_clean') return <IssueItem key={key} title="Not Cleaned" details="A cleaning fee was applied." />;
                                    if (value.status === 'damaged') return <IssueItem key={key} title="Damage Reported" details="Damage fees were applied. See photos below." />;
                                    return null;
                                })}
                            </div>
                        )}

                        {booking.damage_photos && booking.damage_photos.length > 0 && (
                             <div className="mt-4">
                                <h5 className="font-bold text-blue-100 flex items-center"><Image className="mr-2 h-5 w-5" />Damage Photos</h5>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {booking.damage_photos.map((photo, i) => (
                                        <a href={photo.url} target="_blank" rel="noopener noreferrer" key={i} className="text-cyan-300 hover:text-cyan-200 underline text-sm">Photo {i+1}</a>
                                    ))}
                                </div>
                             </div>
                        )}

                        {Object.keys(fees).length > 0 && (
                             <div className="mt-4 border-t border-white/20 pt-4 space-y-2">
                                <h5 className="font-bold text-green-400 flex items-center"><DollarSign className="mr-2 h-5 w-5" />Additional Fees Charged</h5>
                                {Object.entries(fees).map(([key, value]) => (
                                     <div key={key} className="bg-green-900/20 p-2 rounded-md">
                                        <p className="font-semibold text-green-200">{value.description}</p>
                                        <p className="text-sm text-green-300">Amount: ${parseFloat(value.amount).toFixed(2)}</p>
                                        <p className="text-xs text-gray-400">Charge ID: {value.charge_id}</p>
                                     </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};