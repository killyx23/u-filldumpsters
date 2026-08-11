#!/usr/bin/env bash
# Deploy PIN-related edge functions that are too large for MCP inline deploy.
# Requires: supabase login (or SUPABASE_ACCESS_TOKEN) and project link.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${SUPABASE_PROJECT_REF:-essesdjgtmralbkglpzw}"

npx supabase functions deploy ensure-lock-pin-ready --project-ref "$REF" --no-verify-jwt
npx supabase functions deploy generate-daily-pins --project-ref "$REF" --no-verify-jwt
npx supabase functions deploy generate-pin --project-ref "$REF"
npx supabase functions deploy send-booking-confirmation --project-ref "$REF"

echo "Deployed PIN readiness functions to $REF"
