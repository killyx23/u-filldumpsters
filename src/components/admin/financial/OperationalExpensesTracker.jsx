import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinancialData } from '@/hooks/useFinancialData';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { Download, Loader2, Plus } from 'lucide-react';
import { useTruckOperatingCosts } from '@/hooks/useTruckOperatingCosts';
import { OperatingCostDetailsSummary } from './OperatingCostDetailsSummary';
import { exportToCSV } from '@/utils/exportToCSV';
import { OPERATING_EXPENSE_CATEGORIES, summarizeOperatingExpenses } from '@/utils/operatingCost';
import { CreditCardFeeField } from './CreditCardFeeField';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(key) {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

function formatQuantity(line) {
  const amount = Number(line.quantity || 0).toFixed(1);
  return line.unit === 'minutes' ? `${amount} min` : `${amount} mi`;
}

export const OperationalExpensesTracker = () => {
  const { data, refresh } = useFinancialData();
  const { totals, logs, rates, loading: costsLoading } = useTruckOperatingCosts();
  const expenseSummary = useMemo(
    () => summarizeOperatingExpenses(logs, rates),
    [logs, rates],
  );
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    category_id: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    vendor: '',
  });

  const exportCategories = () => {
    exportToCSV(
      expenseSummary.lines.map((line) => ({
        date: line.date,
        category: line.category,
        booking: line.bookingId ? `#${line.bookingId}` : '',
        quantity: Number(line.quantity || 0).toFixed(1),
        unit: line.unit,
        amount: Number(line.amount || 0).toFixed(2),
      })),
      'truck-expense-categories',
      [
        { key: 'date', header: 'Date' },
        { key: 'category', header: 'Category' },
        { key: 'booking', header: 'Booking' },
        { key: 'quantity', header: 'Quantity' },
        { key: 'unit', header: 'Unit' },
        { key: 'amount', header: 'Amount' },
      ],
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const { error } = await supabase.from('financial_expenses').insert([{
        ...formData,
        amount: parseFloat(formData.amount),
      }]);

      if (error) throw error;

      toast({
        title: 'Expense Added',
        description: 'Expense entry created successfully.',
      });

      setFormData({
        category_id: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        description: '',
        vendor: '',
      });
      setIsAdding(false);
      refresh();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Total expenses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {costsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-red-300">{formatCurrency(totals.total)}</p>
              <OperatingCostDetailsSummary totals={totals} />
              <p className="text-xs text-gray-400">
                Deliveries are truck operational costs, including maintenance. Customer pickups are trailer operational costs, maintenance only. Manual entries below stay on the ledger and are not included.
              </p>
              <div className="border-t border-gray-700 pt-4">
                <CreditCardFeeField bookings={data.bookings} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {costsLoading ? null : (
        <>
          <div className="flex justify-between items-center gap-4">
            <h2 className="text-2xl font-bold text-white">Expense categories</h2>
            <Button
              type="button"
              onClick={exportCategories}
              disabled={expenseSummary.lines.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Download className="mr-2 h-4 w-4" />
              Export for taxes
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {OPERATING_EXPENSE_CATEGORIES.map((category) => {
              const stats = expenseSummary.categories[category.key];
              return (
                <Card key={category.key} className="bg-gray-800/50 border-gray-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-white text-base">{category.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-gray-300">
                    <p className="text-2xl font-bold text-red-300">{formatCurrency(stats.total)}</p>
                    <p>This month <span className="text-white">{formatCurrency(stats.thisMonth)}</span></p>
                    <p>Monthly average <span className="text-white">{formatCurrency(stats.monthlyAverage)}</span></p>
                    <p className="text-xs text-gray-500">{stats.count} record{stats.count === 1 ? '' : 's'}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Monthly spending</CardTitle>
            </CardHeader>
            <CardContent>
              {expenseSummary.byMonth.length === 0 ? (
                <p className="text-gray-400 text-sm">No fuel, maintenance, or delivery labor recorded on trip logs yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left py-3 px-4 text-gray-300 font-semibold">Month</th>
                        <th className="text-right py-3 px-4 text-gray-300 font-semibold">Truck operational costs</th>
                        <th className="text-right py-3 px-4 text-gray-300 font-semibold">Trailer operational costs</th>
                        <th className="text-right py-3 px-4 text-gray-300 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseSummary.byMonth.map((row) => (
                        <tr key={row.month} className="border-b border-gray-700/50">
                          <td className="py-3 px-4 text-white">{formatMonth(row.month)}</td>
                          <td className="py-3 px-4 text-right text-gray-300">{formatCurrency(row.truckOperational)}</td>
                          <td className="py-3 px-4 text-right text-gray-300">{formatCurrency(row.trailerOperational)}</td>
                          <td className="py-3 px-4 text-right text-red-300 font-semibold">{formatCurrency(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {OPERATING_EXPENSE_CATEGORIES.map((category) => {
            const stats = expenseSummary.categories[category.key];
            return (
              <Card key={`${category.key}-records`} className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white">{category.label} records</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.lines.length === 0 ? (
                    <p className="text-gray-400 text-sm">No {category.label.toLowerCase()} records yet.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-80">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-left py-3 px-4 text-gray-300 font-semibold">Date</th>
                            <th className="text-left py-3 px-4 text-gray-300 font-semibold">Booking</th>
                            <th className="text-right py-3 px-4 text-gray-300 font-semibold">
                              {category.unit === 'minutes' ? 'Minutes' : 'Miles'}
                            </th>
                            <th className="text-right py-3 px-4 text-gray-300 font-semibold">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.lines.map((line) => (
                            <tr key={line.id} className="border-b border-gray-700/50">
                              <td className="py-3 px-4 text-gray-300">{line.date || '—'}</td>
                              <td className="py-3 px-4 text-white">{line.bookingId ? `#${line.bookingId}` : '—'}</td>
                              <td className="py-3 px-4 text-right text-gray-300">{formatQuantity(line)}</td>
                              <td className="py-3 px-4 text-right text-red-300 font-semibold">{formatCurrency(line.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Operational Expenses</h2>
        <Button onClick={() => setIsAdding(!isAdding)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="mr-2 h-4 w-4" />
          Add Expense
        </Button>
      </div>

      {isAdding && (
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">New Expense Entry</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category" className="text-gray-300">Category</Label>
                  <Select value={formData.category_id} onValueChange={(val) => setFormData(prev => ({ ...prev, category_id: val }))}>
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {data.categories.filter(c => c.category_type === 'expense').map(cat => (
                        <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="amount" className="text-gray-300">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                    className="bg-gray-900 border-gray-700 text-white"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="date" className="text-gray-300">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                    className="bg-gray-900 border-gray-700 text-white"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="vendor" className="text-gray-300">Vendor</Label>
                  <Input
                    id="vendor"
                    value={formData.vendor}
                    onChange={(e) => setFormData(prev => ({ ...prev, vendor: e.target.value }))}
                    className="bg-gray-900 border-gray-700 text-white"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="description" className="text-gray-300">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="bg-gray-900 border-gray-700 text-white"
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="bg-green-600 hover:bg-green-700">Save Expense</Button>
                <Button type="button" onClick={() => setIsAdding(false)} variant="outline" className="border-gray-600 text-gray-300">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Expenses List */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Recent Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Date</th>
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Category</th>
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Description</th>
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Vendor</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.slice(0, 50).map((exp, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-4 text-gray-300">{new Date(exp.date).toLocaleDateString()}</td>
                    <td className="py-3 px-4 text-white">{exp.financial_categories?.name || 'N/A'}</td>
                    <td className="py-3 px-4 text-gray-300">{exp.description}</td>
                    <td className="py-3 px-4 text-gray-300">{exp.vendor || 'N/A'}</td>
                    <td className="py-3 px-4 text-right text-red-400 font-bold">{formatCurrency(exp.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};