# Chat Implementation Audit Report

## 1. Current Message Fetching
Currently, messages are fetched statically on mount or via manual refresh. There is no active polling or real-time subscription in the provided `CommunicationLog.jsx` or `CommunicationHub.jsx`. Messages are passed down as `initialNotes` or `notes` props.

## 2. Existing Message Table Structure
Messages are currently stored in the `customer_notes` table alongside system logs and support tickets. 
Fields used: `id`, `customer_id`, `booking_id`, `source` ('Customer Portal Chat' or 'Admin'), `content`, `is_read`, `created_at`, `author_type`, `attachment_url`, `attachment_name`.

## 3. Real-Time Subscriptions
No real-time subscriptions are currently active. `supabase.channel` is not being utilized in the current implementations.

## 4. Why Messages Don't Appear Instantly
Because there are no WebSockets or polling mechanisms, new messages inserted into the database by one party are not pushed to the other party's client. A full page reload or manual state refresh is required to trigger a new `SELECT` query.

## 5. Data Source Synchronization
Both components query the `customer_notes` table, but they filter differently (e.g., `CommunicationHub` filters out `source === 'Support Ticket'` for the chat tab). They use the same underlying data source but lack a unified real-time synchronization layer.

## 6. Current Message Format & Storage
Messages are stored as plain text in the `content` field of `customer_notes`. Attachments are stored in Supabase Storage (`customer-uploads`) and linked via `attachment_url` and `attachment_name`. The system lacks dedicated fields for message delivery status (sent, delivered, read) beyond a simple `is_read` boolean that is primarily used for admin notification badges.