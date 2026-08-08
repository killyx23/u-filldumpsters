import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTaxCalculations } from '@/hooks/useTaxCalculations';
import { getTaxRecordsForDateRange, syncMissingTaxRecordsFromBookings } from '@/utils/createTaxRecord';
import { formatCurrency } from '@/utils/formatCurrency';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Percent, RefreshCw, Receipt } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export const TaxCollectionModule = () => {
  const {
    totalTaxCollected,
    totalTaxableSubtotal,
    totalNonTaxableSubtotal,
    netRevenueExTax,
    taxedBookingCount,
    taxByBooking,
    taxByMonth,
    loading,
  } = useTaxCalculations();

  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showVoided, setShowVoided] = useState(true);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const rows = await getTaxRecordsForDateRange(null, null, { includeVoided: true });
      setLedgerRows(rows || []);
    } catch (error) {
      console.error('[TaxCollectionModule] ledger load failed:', error);
      toast({
        title: 'Failed to load tax ledger',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const displayRows = useMemo(() => {
    const filtered = showVoided ? ledgerRows : ledgerRows.filter((r) => !r.voided_at);
    if (filtered.length > 0) return filtered;

    // Fallback from bookings when ledger empty / incomplete
    return taxByBooking.map((row) => ({
      id: `booking-${row.bookingId}`,
      booking_id: row.bookingId,
      tax_amount: row.taxAmount,
      tax_rate: row.taxRate,
      subtotal_before_tax: row.subtotalBeforeTax,
      taxable_subtotal: row.taxableSubtotal,
      non_taxable_subtotal: row.nonTaxableSubtotal,
      tax_jurisdiction: row.jurisdiction,
      created_at: row.createdAt,
      voided_at: null,
      bookings: {
        id: row.bookingId,
        status: row.status,
        customers: { name: row.customerName, email: row.customerEmail },
      },
      _fromBookingFallback: true,
    }));
  }, [ledgerRows, showVoided, taxByBooking]);

  const collectedFromLedger = useMemo(
    () => ledgerRows.filter((r) => !r.voided_at).reduce((sum, r) => sum + Number(r.tax_amount || 0), 0),
    [ledgerRows]
  );

  const handleSyncMissing = async () => {
    setSyncing(true);
    try {
      const result = await syncMissingTaxRecordsFromBookings();
      toast({
        title: 'Tax ledger synced',
        description: `Synced ${result.synced} missing record(s) from ${result.scanned} booking(s).`,
      });
      await loadLedger();
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  if (loading && ledgerLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Percent className="h-6 w-6 text-amber-400" />
            Sales Tax Collected
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Durable ledger of all sales tax taken on bookings. Cancelled bookings are voided and excluded from totals.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-gray-600 text-gray-200"
            onClick={() => setShowVoided((v) => !v)}
          >
            {showVoided ? 'Hide voided' : 'Show voided'}
          </Button>
          <Button
            variant="outline"
            className="border-amber-600 text-amber-300"
            onClick={handleSyncMissing}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync missing
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-amber-900/40 to-amber-800/20 border-amber-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-100">Total Tax Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-300">
              {formatCurrency(Math.max(totalTaxCollected, collectedFromLedger))}
            </div>
            <p className="text-xs text-amber-200 mt-1">{taxedBookingCount} taxed bookings</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-200">Taxable Subtotal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{formatCurrency(totalTaxableSubtotal)}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-200">Non-taxable Subtotal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{formatCurrency(totalNonTaxableSubtotal)}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-200">Net Revenue (ex-tax)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-300">{formatCurrency(netRevenueExTax)}</div>
          </CardContent>
        </Card>
      </div>

      {taxByMonth.length > 0 && (
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Tax by Month</CardTitle>
            <CardDescription className="text-gray-400">Collected sales tax from active bookings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {taxByMonth.map((row) => (
                <div key={row.month} className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{row.month}</p>
                  <p className="text-lg font-semibold text-amber-300">{formatCurrency(row.amount)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Receipt className="h-5 w-5 text-amber-400" />
            Tax Ledger
          </CardTitle>
          <CardDescription className="text-gray-400">
            One record per booking. Voided rows remain for audit but are not counted as collected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ledgerLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
            </div>
          ) : displayRows.length === 0 ? (
            <p className="text-center text-gray-400 py-10">No tax records found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 pr-3">Booking</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Rate</th>
                    <th className="py-2 pr-3">Taxable</th>
                    <th className="py-2 pr-3">Tax</th>
                    <th className="py-2 pr-3">Jurisdiction</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const voided = Boolean(row.voided_at);
                    const customer = row.bookings?.customers;
                    return (
                      <tr key={row.id} className="border-b border-gray-800/80 text-gray-200">
                        <td className="py-2.5 pr-3 font-medium text-white">#{row.booking_id}</td>
                        <td className="py-2.5 pr-3">
                          <div>{customer?.name || '—'}</div>
                          <div className="text-xs text-gray-500">{customer?.email || ''}</div>
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          {row.created_at ? format(parseISO(row.created_at), 'MMM d, yyyy') : '—'}
                        </td>
                        <td className="py-2.5 pr-3">{Number(row.tax_rate || 0).toFixed(2)}%</td>
                        <td className="py-2.5 pr-3">{formatCurrency(row.taxable_subtotal ?? row.subtotal_before_tax)}</td>
                        <td className={`py-2.5 pr-3 font-semibold ${voided ? 'text-gray-500 line-through' : 'text-amber-300'}`}>
                          {formatCurrency(row.tax_amount)}
                        </td>
                        <td className="py-2.5 pr-3">{row.tax_jurisdiction || '—'}</td>
                        <td className="py-2.5">
                          {voided ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-red-900/40 text-red-300">Voided</span>
                          ) : row._fromBookingFallback ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-yellow-900/40 text-yellow-300">From booking</span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-green-900/40 text-green-300">Collected</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
