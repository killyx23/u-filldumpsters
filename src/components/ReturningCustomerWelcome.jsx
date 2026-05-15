import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Sparkles, RotateCcw, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';

export const ReturningCustomerWelcome = ({ 
  customerData, 
  pastBookingsCount, 
  lastOrderDate,
  onContinueWithSaved,
  onStartFresh 
}) => {
  const customerName = customerData.first_name 
    ? `${customerData.first_name} ${customerData.last_name || ''}`.trim()
    : customerData.name;

  const formattedLastOrder = lastOrderDate 
    ? format(new Date(lastOrderDate), 'MMMM d, yyyy')
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mb-6"
    >
      <Card className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border-2 border-blue-500/50 shadow-xl backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="bg-yellow-500/20 rounded-full p-3 flex-shrink-0">
              <Sparkles className="h-8 w-8 text-yellow-400" />
            </div>
            
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  Welcome Back, {customerName}! 
                  <CheckCircle2 className="h-6 w-6 text-green-400" />
                </h3>
                <p className="text-blue-200 mt-1">
                  It's great to see you again! You've been a valued customer.
                </p>
              </div>

              {pastBookingsCount > 0 && (
                <div className="bg-black/20 rounded-lg p-4 border border-white/10">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <p className="text-3xl font-bold text-yellow-400">{pastBookingsCount}</p>
                      <p className="text-sm text-blue-200">
                        {pastBookingsCount === 1 ? 'Order' : 'Orders'} Completed
                      </p>
                    </div>
                    {formattedLastOrder && (
                      <div>
                        <p className="text-lg font-semibold text-white">{formattedLastOrder}</p>
                        <p className="text-sm text-blue-200">Last Order Date</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button 
                  onClick={onContinueWithSaved}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white py-6 text-base font-semibold shadow-lg"
                >
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Continue with Saved Details
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                
                <Button 
                  onClick={onStartFresh}
                  variant="outline"
                  className="flex-1 border-white/30 text-white hover:bg-white/10 py-6 text-base"
                >
                  <RotateCcw className="mr-2 h-5 w-5" />
                  Start Fresh
                </Button>
              </div>

              <p className="text-xs text-blue-300 text-center pt-2">
                💡 Your saved details make checkout faster and easier!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};