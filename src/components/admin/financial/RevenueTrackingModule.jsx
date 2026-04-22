
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRevenueCalculations } from '@/hooks/useRevenueCalculations';
import { formatCurrency } from '@/utils/formatCurrency';
import { exportToCSV } from '@/utils/exportToCSV';
import { Download, TrendingUp, Users, Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export const RevenueTrackingModule = () => {
  const [dateRange, setDateRange] = useState('ytd');
  const { totalRevenue, revenueByService, revenueByCustomer, revenueByMonth, loading } = useRevenueCalculations();

  const handleExport = () => {
    exportToCSV(revenueByCustomer, 'revenue-by-customer', [
      { key: 'name', header: 'Customer Name' },
      { key: 'bookingCount', header: 'Total Bookings' },
      { key: 'revenue', header: 'Total Revenue' },
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[180px] bg-gray-800 border-gray-700 text-white">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent className="bg-gray-800 border-gray-700">
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handleExport} className="bg-blue-600 hover:bg-blue-700">
          <Download className="mr-2 h-4 w-4" />
          Export Revenue Data
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-green-900/40 to-green-800/20 border-green-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-100">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-300">{formatCurrency(totalRevenue)}</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-100">Total Customers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-300">{revenueByCustomer.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border-purple-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-100">Service Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-300">{revenueByService.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Service Chart */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Revenue by Service Type</CardTitle>
          <CardDescription className="text-gray-400">Breakdown of revenue by service</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueByService}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                formatter={(value) => formatCurrency(value)}
              />
              <Legend />
              <Bar dataKey="amount" fill="#10b981" name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Customers Table */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Top Customers by Revenue</CardTitle>
          <CardDescription className="text-gray-400">Showing top 20 customers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Customer Name</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Bookings</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Total Revenue</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Avg/Booking</th>
                </tr>
              </thead>
              <tbody>
                {revenueByCustomer.slice(0, 20).map((customer, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-4 text-white">{customer.name}</td>
                    <td className="py-3 px-4 text-right text-gray-300">{customer.bookingCount}</td>
                    <td className="py-3 px-4 text-right text-green-400 font-bold">
                      {formatCurrency(customer.revenue)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-300">
                      {formatCurrency(customer.revenue / customer.bookingCount)}
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
