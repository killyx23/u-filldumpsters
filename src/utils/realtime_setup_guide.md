
# Supabase Realtime Setup Guide

## Task 8: Verify Supabase real-time publication configuration

If real-time events are still not broadcasting after the code updates, you must manually enable Realtime for specific tables in the Supabase Dashboard.

### Required Tables
1. `chat_messages`
2. `typing_indicators`
3. `customer_notes`

### Steps to Enable via Dashboard
1. Go to your Supabase Project Dashboard.
2. Navigate to **Database** -> **Replication** (in the sidebar).
3. Under **supabase_realtime**, click **0 tables** (or however many are currently selected).
4. Toggle the switch for the following tables:
   - `chat_messages`
   - `typing_indicators`
   - `customer_notes`
5. Click **Save**.

### Why is this necessary?
By default, Supabase does not broadcast changes for all tables to prevent performance degradation and excessive bandwidth usage. Tables must be explicitly opted-in to the `supabase_realtime` publication.

### RLS Considerations
Realtime respects Row Level Security (RLS). We have updated the policies to use `EXISTS()` rather than `IN()` with subqueries, as the WAL (Write-Ahead Log) pipeline evaluates policies slightly differently than standard REST API requests.
