import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinancialData } from '@/hooks/useFinancialData';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { Plus, Download } from 'lucide-react';

export const OperationalExpensesTracker = () => {
  const { data, refresh } = useFinancialData();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    category_id: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    vendor: '',
  });

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