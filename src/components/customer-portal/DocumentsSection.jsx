import React, { useRef, useState } from 'react';
import { FileText, Download, Eye, FileDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export const DocumentsSection = ({ bookings, customerData }) => {
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const receiptRef = useRef();

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
  });

  const handleDownload = (booking) => {
    setSelectedBooking(booking);
    // Slight delay to ensure React commits the ref update before printing
    setTimeout(() => {
        handlePrint();
    }, 100);
  };

  const handleView = (booking) => {
    setSelectedBooking(booking);
    setIsViewerOpen(true);
  };

  const completedOrConfirmedBookings = bookings.filter(b => 
    ['Confirmed', 'Delivered', 'Completed', 'flagged'].includes(b.status)
  ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Self-Service Documents</h2>
        <p className="text-sm text-blue-200">Access receipts, invoices, and rental agreements.</p>
      </div>

      {completedOrConfirmedBookings.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-400">
          <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-white mb-2">No Documents Available</h3>
          <p>You don't have any finalized bookings with documents yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {completedOrConfirmedBookings.map(booking => (
             <Card key={booking.id} className="bg-black/20 border-white/10 hover:bg-white/5 transition-colors">
               <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                 <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="bg-blue-500/20 p-2 rounded text-blue-400">
                            <FileText className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-bold text-white">Receipt #{booking.id}</p>
                            <p className="text-xs text-gray-400">{format(parseISO(booking.created_at), 'MMM d, yyyy')}</p>
                        </div>
                    </div>
                    <span className="font-bold text-green-400">${(booking.total_price || 0).toFixed(2)}</span>
                 </div>
                 
                 <div className="text-sm text-gray-300">
                    <p className="truncate">{booking.plan?.name}</p>
                 </div>

                 <div className="flex gap-2 pt-2 border-t border-white/10">
                    <Button variant="outline" size="sm" onClick={() => handleView(booking)} className="flex-1 bg-transparent border-white/20 hover:bg-white/10">
                        <Eye className="w-4 h-4 mr-2" /> View
                    </Button>
                    <Button size="sm" onClick={() => handleDownload(booking)} className="flex-1 bg-blue-600 hover:bg-blue-700">
                        <Download className="w-4 h-4 mr-2" /> PDF
                    </Button>
                 </div>
               </CardContent>
             </Card>
          ))}
        </div>
      )}

      {/* Hidden printable component */}
      <div style={{ display: 'none' }}>
        <PrintableReceipt 
            ref={receiptRef} 
            booking={selectedBooking ? { ...selectedBooking, customers: customerData } : null} 
        />
      </div>

      <Dialog open={isViewerOpen} onOpenChange={setIsViewerOpen}>
        <DialogContent className="max-w-3xl bg-gray-900 border-yellow-400 text-white h-[85vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Document Viewer - Booking #{selectedBooking?.id}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4 bg-white rounded-md my-4">
               {/* Re-use PrintableReceipt for preview, wrapped in white bg for visibility */}
               <PrintableReceipt booking={selectedBooking ? { ...selectedBooking, customers: customerData } : null} />
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setIsViewerOpen(false)}>Close</Button>
                <Button onClick={() => {
                    handlePrint();
                    setIsViewerOpen(false);
                }} className="bg-blue-600 hover:bg-blue-700">
                    <FileDown className="w-4 h-4 mr-2"/> Download PDF
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};