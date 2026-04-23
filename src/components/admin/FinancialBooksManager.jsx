
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinancialDashboard } from './financial/FinancialDashboard';
import { RevenueTrackingModule } from './financial/RevenueTrackingModule';
import { EquipmentCostManagement } from './financial/EquipmentCostManagement';
import { OperationalExpensesTracker } from './financial/OperationalExpensesTracker';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Truck, 
  Receipt, 
  Gauge, 
  FileText, 
  LineChart, 
  Settings, 
  History 
} from 'lucide-react';

export const FinancialBooksManager = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-900/40 to-blue-900/40 p-6 rounded-lg border border-green-700/50">
        <h1 className="text-3xl font-bold text-white mb-2">Financial Books</h1>
        <p className="text-gray-300">Complete financial management and reporting system</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-1 bg-gray-800/50 p-2 rounded-lg h-auto">
          <TabsTrigger value="dashboard" className="py-2">
            <LayoutDashboard className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="revenue" className="py-2">
            <TrendingUp className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Revenue</span>
          </TabsTrigger>
          <TabsTrigger value="equipment" className="py-2">
            <Truck className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Equipment</span>
          </TabsTrigger>
          <TabsTrigger value="expenses" className="py-2">
            <Receipt className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Expenses</span>
          </TabsTrigger>
          <TabsTrigger value="mileage" className="py-2">
            <Gauge className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Mileage</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="py-2">
            <FileText className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Reports</span>
          </TabsTrigger>
          <TabsTrigger value="projections" className="py-2">
            <LineChart className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Projections</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="py-2">
            <Settings className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Settings</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="py-2">
            <History className="w-4 h-4 mr-1 lg:mr-2" />
            <span className="hidden lg:inline">Audit</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <FinancialDashboard />
        </TabsContent>

        <TabsContent value="revenue" className="mt-6">
          <RevenueTrackingModule />
        </TabsContent>

        <TabsContent value="equipment" className="mt-6">
          <EquipmentCostManagement />
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <OperationalExpensesTracker />
        </TabsContent>

        <TabsContent value="mileage" className="mt-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <Gauge className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Mileage & Service Tracking</h3>
            <p className="text-gray-400">Track equipment mileage, service intervals, and maintenance schedules</p>
            <p className="text-sm text-yellow-400 mt-4">Module under development</p>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <FileText className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Financial Reports</h3>
            <p className="text-gray-400">Generate P&L, Balance Sheet, Cash Flow, and custom reports</p>
            <p className="text-sm text-yellow-400 mt-4">Module under development</p>
          </div>
        </TabsContent>

        <TabsContent value="projections" className="mt-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <LineChart className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Financial Projections</h3>
            <p className="text-gray-400">Revenue forecasting, expense projections, and scenario planning</p>
            <p className="text-sm text-yellow-400 mt-4">Module under development</p>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <Settings className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Settings & Customization</h3>
            <p className="text-gray-400">Manage categories, formulas, and financial tracking preferences</p>
            <p className="text-sm text-yellow-400 mt-4">Module under development</p>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <History className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Audit Trail</h3>
            <p className="text-gray-400">Complete change history and compliance reporting</p>
            <p className="text-sm text-yellow-400 mt-4">Module under development</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
