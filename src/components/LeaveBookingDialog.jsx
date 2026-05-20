import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export const LeaveBookingDialog = ({ open, onOpenChange, onConfirm, onCancel }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
      <AlertDialogHeader>
        <AlertDialogTitle>Leave booking?</AlertDialogTitle>
        <AlertDialogDescription className="text-gray-400">
          If you return to the home page, your current booking progress will be discarded and you
          will need to start over.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel
          onClick={onCancel}
          className="border-gray-700 text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          Return to home page
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
