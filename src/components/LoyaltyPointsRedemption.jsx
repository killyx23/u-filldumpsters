import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gift, Sparkles, AlertCircle } from 'lucide-react';
import { useCustomerLoyaltyPoints } from '@/hooks/useCustomerLoyaltyPoints';

export const LoyaltyPointsRedemption = ({ customerId, onPointsRedemption, currentTotal }) => {
  const {
    pointsBalance,
    loading,
    conversionRates,
    calculateDiscountFromPoints,
  } = useCustomerLoyaltyPoints(customerId);

  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (pointsToRedeem > 0) {
      const discount = calculateDiscountFromPoints(pointsToRedeem);
      setDiscountAmount(discount);
      
      if (pointsToRedeem > pointsBalance) {
        setError(`You only have ${pointsBalance} points available`);
      } else if (discount > currentTotal) {
        setError('Discount cannot exceed order total');
      } else {
        setError('');
      }
    } else {
      setDiscountAmount(0);
      setError('');
    }
  }, [pointsToRedeem, pointsBalance, currentTotal, calculateDiscountFromPoints]);

  const handleRedeemMax = () => {
    const maxPointsForTotal = Math.floor(currentTotal * conversionRates.pointsToDollar);
    const maxRedeemable = Math.min(pointsBalance, maxPointsForTotal);
    setPointsToRedeem(maxRedeemable);
  };

  const handleApplyPoints = () => {
    if (pointsToRedeem <= 0) return;
    if (pointsToRedeem > pointsBalance) {
      setError('Insufficient points');
      return;
    }
    if (discountAmount > currentTotal) {
      setError('Discount cannot exceed order total');
      return;
    }

    onPointsRedemption(pointsToRedeem, discountAmount);
  };

  const handleClearPoints = () => {
    setPointsToRedeem(0);
    setDiscountAmount(0);
    setError('');
    onPointsRedemption(0, 0);
  };

  if (loading) {
    return (
      <Card className="bg-purple-900/20 border-purple-500/30">
        <CardContent className="p-6">
          <p className="text-sm text-gray-400">Loading loyalty points...</p>
        </CardContent>
      </Card>
    );
  }

  if (!customerId || pointsBalance === 0) {
    return null;
  }

  return (
    <Card className="bg-gradient-to-br from-purple-900/40 to-indigo-800/20 border-purple-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-purple-300">
          <Gift className="h-5 w-5" />
          Loyalty Points Rewards
        </CardTitle>
        <CardDescription className="text-purple-100/80">
          You have <span className="font-bold text-purple-300">{pointsBalance} points</span> available
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-black/30 p-4 rounded-lg border border-purple-700/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-purple-200">Conversion Rate:</span>
            <span className="text-sm font-bold text-purple-300">
              {conversionRates.pointsToDollar} points = $1.00
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-purple-200">Maximum Discount:</span>
            <span className="text-sm font-bold text-purple-300">
              ${calculateDiscountFromPoints(pointsBalance).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pointsToRedeem" className="text-white">
            Points to Redeem
          </Label>
          <div className="flex gap-2">
            <Input
              id="pointsToRedeem"
              type="number"
              min="0"
              max={pointsBalance}
              value={pointsToRedeem}
              onChange={(e) => setPointsToRedeem(Number(e.target.value))}
              className="flex-1 text-white"
              placeholder="Enter points"
            />
            <Button
              type="button"
              onClick={handleRedeemMax}
              variant="outline"
              className="whitespace-nowrap"
            >
              Max
            </Button>
          </div>
        </div>

        {discountAmount > 0 && !error && (
          <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-bold text-green-300">
                Discount: ${discountAmount.toFixed(2)}
              </p>
              <p className="text-xs text-green-100/80">
                Redeeming {pointsToRedeem} points
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleApplyPoints}
            disabled={!pointsToRedeem || pointsToRedeem <= 0 || !!error}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
          >
            Apply Points
          </Button>
          {pointsToRedeem > 0 && (
            <Button
              onClick={handleClearPoints}
              variant="outline"
              className="flex-1"
            >
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};