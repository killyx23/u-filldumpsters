
# Real-Time Chat Testing Guide

## Preparation
1. Open two separate browser windows (or one normal window and one incognito window).
2. **Window 1 (Admin)**: Log in to the Admin Dashboard and navigate to a Customer Detail page > Communications tab.
3. **Window 2 (Customer)**: Log in to the Customer Portal using the credentials of the same customer you are viewing in the Admin panel. Navigate to the "Communication Hub" > "Direct Chat" tab.

## Test Cases

### 1. Connection & History
*   **Action**: Refresh both pages.
*   **Expected**: 
    *   Both windows should display a "Live" or "Connected" green status badge.
    *   Any existing historical messages sent using the old `customer_notes` system will *not* automatically migrate to the new `chat_messages` table without a manual DB script. The new chat starts fresh.
    *   Both windows should cleanly load with "No messages yet" if starting fresh.

### 2. Real-Time Delivery (Admin -> Customer)
*   **Action**: In the Admin window, type "Hello from Admin!" and press Enter (or click send).
*   **Expected**:
    *   Admin window: Message appears instantly with a "clock" icon (sending), then changes to a "check" icon (delivered).
    *   Customer window: The message "Hello from Admin!" appears instantly on the left side of the screen without requiring a page refresh.

### 3. Real-Time Delivery (Customer -> Admin)
*   **Action**: In the Customer window, type "Hello back from Customer!" and press Enter.
*   **Expected**:
    *   Customer window: Message appears on the right (blue bubble).
    *   Admin window: Message appears instantly on the left (gray bubble).
    *   The read status (double checkmarks) should update automatically when the other party receives/focuses the chat.

### 4. Typing Indicators
*   **Action**: In the Admin window, start typing a long message but do not send it. Look at the Customer window.
*   **Expected**:
    *   Customer window: You should see "Support Team is typing..." with 3 animated bouncing dots at the bottom of the chat.
*   **Action**: Stop typing for 3-4 seconds.
*   **Expected**:
    *   Customer window: The typing indicator should disappear automatically.
*   **Action**: Repeat the reverse (type in Customer window, observe Admin window). The Admin window should say "Customer is typing...".

### 5. Auto-Scrolling
*   **Action**: Send enough short messages back and forth to fill the screen until a scrollbar appears.
*   **Expected**: When a new message is sent or received, the chat container should automatically scroll to the absolute bottom so the newest message is fully visible.

### 6. Disconnect / Reconnect Simulation
*   **Action**: In the Customer window, disconnect your internet (or open DevTools -> Network -> Offline).
*   **Expected**: The status badge should change to "Offline" or "Reconnecting...".
*   **Action**: Send a message from the Admin window.
*   **Expected**: The Customer window will obviously not see it.
*   **Action**: Reconnect the internet. 
*   **Expected**: The Customer window reconnects, and when it fetches the latest state, the missed message from the admin appears.

## Summary
If all these tests pass, the real-time Supabase integration is functioning flawlessly, replacing the old manual polling method with immediate WebSocket delivery via Supabase Channels.
