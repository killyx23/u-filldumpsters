import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEquipmentROI } from '@/hooks/useEquipmentROI';
import { useEquipmentUtilization } from '@/hooks/useEquipmentUtilization';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { Loader2, Plus, TrendingUp, TrendingDown } from 'lucide-react';

const EQUIPMENT_TYPES = ['Dump trailer', 'Truck', 'Dumpster', 'Other'];

const emptyForm = () => ({
  name: '',
  equipment_type: 'Dump trailer',
  purchase_price: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  current_value: '',
});

export const EquipmentCostManagement = () => {
  const { roiData, loading: roiLoading, refetch: refetchRoi } = useEquipmentROI();
  const { utilizationData, loading: utilLoading, refetch: refetchUtil } = useEquipmentUtilization();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const saveEquipment = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const purchasePrice = Number(form.purchase_price);
    const currentValue = form.current_value === '' ? purchasePrice : Number(form.current_value);

    if (!name) {
      toast({ title: 'Enter an equipment name', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      toast({ title: 'Enter a purchase cost of zero or more', variant: 'destructive' });
      return;
    }
    if (!form.purchase_date) {
      toast({ title: 'Enter the purchase date', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(currentValue) || currentValue < 0) {
      toast({ title: 'Enter a current value of zero or more', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('equipment_inventory').insert({
      name,
      equipment_type: form.equipment_type,
      purchase_date: form.purchase_date,
      purchase_price: purchasePrice,
      current_value: currentValue,
      depreciation_rate: 0,
      condition: 'Good',
      status: 'Active',
    }).select('id').single();
    setSaving(false);

    if (error) {
      toast({
        title: 'Could not add equipment',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setForm(emptyForm());
    toast({
      title: 'Equipment added',
      description: `${name} is now in the ROI analysis.`,
    });
    await Promise.all([
      refetchRoi(true),
      refetchUtil(true),
    ]);
  };

  if (roiLoading || utilLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Add equipment</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveEquipment} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="equipment-name" className="text-gray-300">Name</Label>
              <Input
                id="equipment-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Dump trailer"
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-300">Type</Label>
              <Select
                value={form.equipment_type}
                onValueChange={(value) => setForm((current) => ({ ...current, equipment_type: value }))}
              >
                <SelectTrigger className="bg-gray-900 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-cost" className="text-gray-300">Purchase cost</Label>
              <Input
                id="equipment-cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.purchase_price}
                onChange={(event) => setForm((current) => ({ ...current, purchase_price: event.target.value }))}
                placeholder="0.00"
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-date" className="text-gray-300">Purchase date</Label>
              <Input
                id="equipment-date"
                type="date"
                value={form.purchase_date}
                onChange={(event) => setForm((current) => ({ ...current, purchase_date: event.target.value }))}
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-value" className="text-gray-300">Current value</Label>
              <Input
                id="equipment-value"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.current_value}
                onChange={(event) => setForm((current) => ({ ...current, current_value: event.target.value }))}
                placeholder="Same as purchase cost"
                className="bg-gray-900 border-gray-600 text-white"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving} className="bg-yellow-500 text-black hover:bg-yellow-400">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add equipment
              </Button>
            </div>
          </form>
          <p className="text-xs text-gray-400 mt-4">
            Purchase cost is the investment in the ROI table. Revenue is the total of bookings whose service name includes this equipment name. Maintenance is the expense-ledger total linked to this piece of equipment.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Equipment ROI Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {roiData.length === 0 ? (
            <p className="text-gray-400 text-sm">No equipment yet. Add a piece above and its ROI will show here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-300 font-semibold">Equipment</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Purchase Cost</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Maintenance</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Revenue</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Net Profit</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">ROI %</th>
                  </tr>
                </thead>
                <tbody>
                  {roiData.map((item) => (
                    <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 px-4 text-white">{item.name}</td>
                      <td className="py-3 px-4 text-right text-gray-300">{formatCurrency(item.initialInvestment)}</td>
                      <td className="py-3 px-4 text-right text-red-400">{formatCurrency(item.maintenanceCosts)}</td>
                      <td className="py-3 px-4 text-right text-green-400">{formatCurrency(item.revenue)}</td>
                      <td className={`py-3 px-4 text-right font-bold ${item.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatCurrency(item.netProfit)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`flex items-center justify-end gap-1 font-bold ${item.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {item.roi >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {item.roi}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Equipment Utilization Rates</CardTitle>
        </CardHeader>
        <CardContent>
          {utilizationData.length === 0 ? (
            <p className="text-gray-400 text-sm">Utilization appears after equipment is added.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-300 font-semibold">Equipment</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Total Rentals</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Total Days Rented</th>
                    <th className="text-right py-3 px-4 text-gray-300 font-semibold">Utilization %</th>
                  </tr>
                </thead>
                <tbody>
                  {utilizationData.map((item) => (
                    <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 px-4 text-white">{item.name}</td>
                      <td className="py-3 px-4 text-right text-gray-300">{item.totalRentals}</td>
                      <td className="py-3 px-4 text-right text-gray-300">{item.totalDays}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`font-bold ${parseFloat(item.utilizationRate) >= 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {item.utilizationRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
