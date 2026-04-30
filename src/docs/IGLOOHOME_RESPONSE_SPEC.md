# Igloohome Response Specification

## Overview
This document defines the expected vs actual response formats for the Igloohome PIN generation system.

## ⚠️ Important: RPC vs Edge Function
The system uses a **Postgres RPC function** (`generate_igloohome_pin_rpc`), not a Supabase Edge Function.

## Expected Successful Response

### Structure