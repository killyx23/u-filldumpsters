# Igloohome Edge Function Specification

## Function Overview
- **Function Name**: `generate-igloohome-pin`
- **Type**: Supabase Edge Function
- **Location**: `supabase/functions/generate-igloohome-pin/index.ts`
- **Endpoint**: `https://<project-ref>.supabase.co/functions/v1/generate-igloohome-pin`
- **HTTP Method**: POST
- **Content-Type**: application/json

## Authentication Requirements
- **Authorization Header**: `Bearer <SUPABASE_ANON_KEY>`
- **Security**: DEFINER (runs with elevated privileges)
- Edge Function is publicly accessible but requires valid Supabase anon key

## Environment Variables/Secrets Required
Based on the RPC function implementation, the following secrets are required:

1. **IGLOOHOME_CLIENT_ID**: OAuth client ID for Igloohome API (Edge Function secret)

2. **IGLOOHOME_CLIENT_SECRET**: OAuth client secret for Igloohome API (Edge Function secret)

3. **IGLOOHOME_LOCK_ID**: Physical lock device ID (Edge Function secret)

## Input Schema

### Required Fields