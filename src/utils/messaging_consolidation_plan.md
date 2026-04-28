# Messaging System Consolidation Plan

## Task 1: Audit and Consolidate
**Objective:** Ensure all direct, real-time user-to-admin chats are strictly isolated to the `chat_messages` table.

1. **Table Roles:**
   - `chat_messages`: PRIMARY live chat messaging table. Holds bidirectional communication.
   - `customer_notes`: Strictly for administrative, system-generated, delivery, verification, or structured support ticket records. NOT for live chat.
   - `typing_indicators`: **DEPRECATED**. Typing indicator subscriptions caused noisy WAL broadcasts and sync interference. Removed to optimize the real-time chat pipeline.

2. **Actions Taken:**
   - Modified `useTypingIndicator.js` to return no-op states, safely deprecating it without breaking component tree signatures.
   - Cleaned `CommunicationLog.jsx` and `CommunicationHub.jsx` to exclusively use `chat_messages` via `useRealTimeChat` for chat.
   - Ran a SQL migration to move any legacy 'Chat Message' entries from `customer_notes` to `chat_messages`.

3. **Status:** Consolidation Complete.