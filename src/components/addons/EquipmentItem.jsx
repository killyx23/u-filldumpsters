
    import React from 'react';
    import { Button } from '@/components/ui/button';
    import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
    import { Minus, Plus } from 'lucide-react';

    export const EquipmentItem = ({ id, label, price, icon, hasQuantitySelector, quantity, onQuantityChange, available }) => {
        const isAvailable = available > 0;
        const canAddMore = available > quantity;

        const addButton = (
            <Button size="sm" variant={quantity > 0 ? "destructive" : "secondary"} onClick={() => onQuantityChange(quantity > 0 ? 0 : 1)} disabled={!isAvailable && quantity === 0}>
                {quantity > 0 ? 'Remove' : (isAvailable ? 'Add' : 'Out of Stock')}
            </Button>
        );

        return (
            <div className="flex items-center p-3 bg-white/10 rounded-lg">
                {icon}
                <span className="ml-3 text-white flex-grow">{label}</span>
                {hasQuantitySelector ? (
                    <div className="flex items-center gap-2">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>
                            <Minus className="h-4 w-4" />
                        </Button>
                        <span className="font-bold text-lg text-white w-8 text-center">{quantity}</span>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(quantity + 1)} disabled={!canAddMore}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            {!canAddMore && <TooltipContent><p>No more available.</p></TooltipContent>}
                        </Tooltip>
                    </div>
                ) : (
                    <>
                        <span className="font-semibold text-green-400 mr-4">+${price.toFixed(2)}</span>
                        {!isAvailable && quantity === 0 ? (
                            <Tooltip>
                                <TooltipTrigger asChild><span tabIndex={0}>{addButton}</span></TooltipTrigger>
                                <TooltipContent><p>This item is temporarily out of stock.</p></TooltipContent>
                            </Tooltip>
                        ) : addButton}
                    </>
                )}
            </div>
        );
    };
  