import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Settings, Users, Package } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookingsManager } from '@/components/admin/BookingsManager';
import { AvailabilityManager } from '@/components/admin/AvailabilityManager';
import { CustomersManager } from '@/components/admin/CustomersManager';
import { EquipmentManager } from '@/components/admin/EquipmentManager';

const AdminDashboard = () => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="container mx-auto py-8 px-4 relative"
        >
            <h1 className="text-4xl font-bold mb-8 text-yellow-400">Admin Dashboard</h1>
            
            <Tabs defaultValue="bookings" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white/10 text-white mb-4">
                    <TabsTrigger value="bookings"><MessageSquare className="mr-2 h-4 w-4" />Bookings</TabsTrigger>
                    <TabsTrigger value="customers"><Users className="mr-2 h-4 w-4" />Customers</TabsTrigger>
                    <TabsTrigger value="equipment"><Package className="mr-2 h-4 w-4" />Equipment</TabsTrigger>
                    <TabsTrigger value="availability"><Settings className="mr-2 h-4 w-4" />Availability</TabsTrigger>
                </TabsList>
                <TabsContent value="bookings">
                    <BookingsManager />
                </TabsContent>
                <TabsContent value="customers">
                    <CustomersManager />
                </TabsContent>
                <TabsContent value="equipment">
                    <EquipmentManager />
                </TabsContent>
                <TabsContent value="availability">
                    <AvailabilityManager />
                </TabsContent>
            </Tabs>
        </motion.div>
    );
};

export default AdminDashboard;