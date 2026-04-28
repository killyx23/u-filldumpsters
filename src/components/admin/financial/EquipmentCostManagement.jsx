import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useEquipmentROI } from '@/hooks/useEquipmentROI';
import { useEquipmentUtilization } from '@/hooks/useEquipmentUtilization';
import { formatCurrency } from '@/utils/formatCurrency';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';

export const EquipmentCostManagement = () => {
  const { roiData, loading: roiLoading } = useEquipmentROI();
  const { utilizationData, loading: utilLoading } = useEquipmentUtilization();

  if (roiLoading || utilLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Equipment ROI Table */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Equipment ROI Analysis</CardTitle>
        </CardHeader>
        <CardContent>
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
                {roiData.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
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
        </CardContent>
      </Card>

      {/* Utilization Rates */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Equipment Utilization Rates</CardTitle>
        </CardHeader>
        <CardContent>
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
                {utilizationData.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
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
        </CardContent>
      </Card>
    </div>
  );
};