
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFinancialData } from '@/hooks/useFinancialData';
import { useRevenueCalculations } from '@/hooks/useRevenueCalculations';
import { formatCurrency } from '@/utils/formatCurrency';
import { TrendingUp, TrendingDown, DollarSign, Truck, Users, Loader2 } from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export const FinancialDashboard = () => {
  const { data, loading } = useFinancialData({ autoRefresh: true });
  const { totalRevenue, grandTotal, avgRevenuePerBooking, revenueByService, revenueByMonth } = useRevenueCalculations();

  const metrics = useMemo(() => {
    const totalExpenses = data.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = grandTotal - totalExpenses;
    const activeEquipment = data.equipment.filter(e => e.status === 'active').length;

    return {
      totalRevenue: grandTotal,
      totalExpenses,
      netProfit,
      cashFlow: netProfit,
      activeEquipment,
      totalBookings: data.bookings.length,
      avgRevenuePerBooking,
    };
  }, [data, grandTotal, avgRevenuePerBooking]);

  const expenseBreakdown = useMemo(() => {
    const breakdown = data.expenses.reduce((acc, exp) => {
      const category = exp.financial_categories?.name || 'Uncategorized';
      acc[category] = (acc[category] || 0) + (exp.amount || 0);
      return acc;
    }, {});

    return Object.entries(breakdown).map(([name, value]) => ({
      name,
      value,
    }));
  }, [data.expenses]);

  const recentTransactions = useMemo(() => {
    const allTransactions = [
      ...data.income.map(i => ({
        type: 'income',
        amount: i.amount,
        description: i.description || i.income_type,
        date: i.date,
      })),
      ...data.expenses.map(e => ({
        type: 'expense',
        amount: e.amount,
        description: e.description || e.financial_categories?.name,
        date: e.date,
      })),
    ];

    return allTransactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-900/40 to-green-800/20 border-green-700/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-100">Total Revenue (YTD)</CardTitle>
            <DollarSign className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-300">{formatCurrency(metrics.totalRevenue)}</div>
            <p className="text-xs text-green-200 mt-1">
              {data.bookings.length} bookings completed
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-900/40 to-red-800/20 border-red-700/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-100">Total Expenses (YTD)</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-300">{formatCurrency(metrics.totalExpenses)}</div>
            <p className="text-xs text-red-200 mt-1">
              {data.expenses.length} expense entries
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-700/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-100">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metrics.netProfit >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {formatCurrency(metrics.netProfit)}
            </div>
            <p className="text-xs text-blue-200 mt-1">
              {((metrics.netProfit / metrics.totalRevenue) * 100).toFixed(1)}% profit margin
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border-purple-700/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-purple-100">Active Equipment</CardTitle>
            <Truck className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-300">{metrics.activeEquipment}</div>
            <p className="text-xs text-purple-200 mt-1">
              {formatCurrency(metrics.avgRevenuePerBooking)} avg/booking
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Revenue vs Expenses</CardTitle>
            <CardDescription className="text-gray-400">Monthly comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="amount" name="Revenue" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expense Breakdown */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Expense Breakdown</CardTitle>
            <CardDescription className="text-gray-400">By category</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={expenseBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {expenseBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                  formatter={(value) => formatCurrency(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Recent Transactions</CardTitle>
          <CardDescription className="text-gray-400">Last 10 entries</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentTransactions.map((trans, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                <div>
                  <p className="text-sm font-medium text-white">{trans.description}</p>
                  <p className="text-xs text-gray-400">{new Date(trans.date).toLocaleDateString()}</p>
                </div>
                <span className={`font-bold ${trans.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                  {trans.type === 'income' ? '+' : '-'}{formatCurrency(trans.amount)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
