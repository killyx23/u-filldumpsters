import {
  buildFriendlyRescheduleReason,
  buildRescheduleRequestChatMessage,
  extractEdgeFunctionError,
} from '@/utils/changeRequestNoteFormatter';

// Re-export under the legacy name used by RescheduleDialog
export {
  buildFriendlyRescheduleReason as buildRescheduleReason,
  buildRescheduleRequestChatMessage,
  extractEdgeFunctionError,
};
