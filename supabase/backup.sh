#!/bin/bash
set -e
# Load environment variables
source ./supabase/.env

BACKUP_DIR="supabase/backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")

#please run this from command line before running this script at root directory of the project:
#npx supabase login
#npx supabase link --project-ref <PROJECT_REF> see .env for PROJECT_REF
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

# ----------------------------
# ----------------------------
# Consolidate All Edge Functions into One File
# ----------------------------
echo "🧩 Consolidating all Edge Functions into a single file..."
ALL_FUNCTIONS_FILE="$BACKUP_DIR/all_edge_functions_$DATE.ts"

# Create or clear consolidated file (no timestamp inside)
echo "// Consolidated Edge Functions Backup" > "$ALL_FUNCTIONS_FILE"
echo "// Each function is separated by headers for clarity" >> "$ALL_FUNCTIONS_FILE"
echo "" >> "$ALL_FUNCTIONS_FILE"

# Iterate again over each function to concatenate their contents
while read -r fn; do
  if [ -n "$fn" ]; then
    FUNC_PATH="$BACKUP_DIR/functions_$DATE/$fn"
    if [ -d "$FUNC_PATH" ]; then
      echo -e "\n\n// ----------------------------" >> "$ALL_FUNCTIONS_FILE"
      echo "// Function: $fn" >> "$ALL_FUNCTIONS_FILE"
      echo "// ----------------------------" >> "$ALL_FUNCTIONS_FILE"
      find "$FUNC_PATH" -type f \( -name "*.ts" -o -name "*.js" \) -exec sh -c '
        for f; do
          echo "\n// --- File: ${f##*/} ---\n" >> "$0"
          cat "$f" >> "$0"
          echo "" >> "$0"
        done
      ' "$ALL_FUNCTIONS_FILE" {} +
    fi
  fi
done <<< "$FUNCTIONS"

echo "✅ Edge Functions backed up and consolidated into $ALL_FUNCTIONS_FILE"
echo "✅ Backup completed. Files saved in $BACKUP_DIR"