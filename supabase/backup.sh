#!/bin/bash
set -e
# Load environment variables
source ./supabase/.env


BACKUP_DIR="supabase/backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")

#npx supabase link --project-ref $PROJECT_REF"
# Login to Supabase CLI (will prompt once if not logged in)

mkdir -p $BACKUP_DIR
echo "🚀 Starting Supabase backup for project: $PROJECT_REF"
# Ensure Supabase CLI is logged in (one-time interactive login required)
# if ! npx supabase status >/dev/null 2>&1;then 
#   echo "🔑 Logging in to Supabase..."
#   npx supabase login 
# fi

# Dump the database schema using Supabase CLI (avoids direct IPv6 connections) 
echo "🗄 Dumping latest database schema..." 
npx supabase db dump --linked --file "$BACKUP_DIR/schema_$DATE.sql"

# Save auth policies / TypeScript types
echo "📑 Saving auth policies and types..."
npx supabase gen types typescript --linked > $BACKUP_DIR/types_$DATE.ts

# # ----------------------------
# # Edge Functions
# # ----------------------------
echo "⚡ Backing up Edge Functions..."
mkdir -p $BACKUP_DIR/functions_$DATE

# Get function names from the list
FUNCTIONS=$(npx supabase functions list --project-ref $PROJECT_REF --output json | jq -r '.[].name')

echo "Detected functions:"
echo "$FUNCTIONS"

# Download each function
while read -r fn; do
    if [ -n "$fn" ]; then
        echo "   - Downloading function: $fn"
        mkdir -p "$BACKUP_DIR/functions_$DATE/$fn"
        npx supabase functions download "$fn" --project-ref $PROJECT_REF --workdir "$BACKUP_DIR/functions_$DATE/$fn" || echo "      ⚠ Failed to download $fn"
    fi
done <<< "$FUNCTIONS"

echo "✅ Backup completed. Files saved in $BACKUP_DIR"