import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MessageSquarePlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const RescheduleCommentsSection = ({ comments, setComments }) => {
    const maxLength = 500;
    
    // Safely extract string value if object is passed by mistake
    const safeComments = typeof comments === 'object' ? (comments?.value || comments?.text || '') : (comments || '');
    const stringComments = String(safeComments);
    const isNearLimit = stringComments.length > maxLength * 0.9;

    return (
        <div className="space-y-3 animate-in fade-in duration-300 max-w-4xl mx-auto w-full">
            <div className="text-center md:text-left space-y-1">
                <h3 className="text-lg font-bold text-white flex items-center justify-center md:justify-start">
                    <MessageSquarePlus className="w-5 h-5 mr-2 text-blue-400" />
                    Additional Comments
                </h3>
                <p className="text-sm text-gray-400">Provide a reason for your request or any special instructions (Optional).</p>
            </div>
            
            <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                    <div className="space-y-2">
                        <Label htmlFor="comments" className="text-gray-300 font-medium text-xs">Notes for our team</Label>
                        <div className="relative">
                            <Textarea
                                id="comments"
                                value={stringComments}
                                onChange={(e) => setComments(e.target.value.slice(0, maxLength))}
                                placeholder="e.g., Flight was delayed, need to shift rental by one day..."
                                className="min-h-[100px] bg-gray-900 border-gray-600 text-white resize-none focus-visible:ring-blue-500 text-sm p-3"
                            />
                            <div className={`absolute bottom-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${isNearLimit ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                                {stringComments.length} / {maxLength}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};