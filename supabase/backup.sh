#!/bin/bash
set -e
# Load environment variables
source ./supabase/.env

BACKUP_DIR="supabase/backups"
DB_BACKUP_DIR="supabase/backups/db"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")

#please run this from command line before running this script at root directory of the project:
#npx supabase login
#npx supabase link --project-ref <PROJECT_REF> see .env for PROJECT_REF
# Login to Supabase CLI (will prompt once if not logged in)
# On db pull — run it once manually to sync migrations folder:
# npx supabase db pull --linked

mkdir -p "$BACKUP_DIR"
mkdir -p "$DB_BACKUP_DIR"
echo "🚀 Starting Supabase backup for project: $PROJECT_REF"

rm -rf supabase/.temp
npx supabase link --project-ref "$PROJECT_REF"
sleep 2  # let the link settle

# ---------------------------------------------------------------------------
# Database schema dump
# ---------------------------------------------------------------------------
echo "🗄 Dumping latest database schema..."
for attempt in 1 2 3; do
  npx supabase db dump --linked > "$DB_BACKUP_DIR/schema_$DATE.sql" && break
  echo "⚠ Dump attempt $attempt failed, retrying..."
  sleep 3
done

# ---------------------------------------------------------------------------
# Database delta (changes since last migration)
# ---------------------------------------------------------------------------
echo "🔍 Generating database diff (delta changes)..."
DIFF_FILE="$DB_BACKUP_DIR/db_${DATE}_changes.sql"
npx supabase db diff --linked > "$DIFF_FILE" 2>/dev/null || true

if [[ -f "$DIFF_FILE" && -s "$DIFF_FILE" ]]; then
  echo "✅ Schema changes detected and saved to: $DIFF_FILE"
else
  echo "ℹ️  No schema changes detected since last migration — diff file skipped."
  rm -f "$DIFF_FILE"
fi

# ---------------------------------------------------------------------------
# Save TypeScript types
# ---------------------------------------------------------------------------
echo "📑 Saving auth policies and types..."
npx supabase gen types typescript --linked > "$DB_BACKUP_DIR/types_$DATE.ts"

# ---------------------------------------------------------------------------
# Edge Functions — download
# ---------------------------------------------------------------------------
echo "⚡ Backing up Edge Functions..."
FUNCTIONS_DIR="$BACKUP_DIR/functions_$DATE"
mkdir -p "$FUNCTIONS_DIR"

FUNCTIONS=$(npx supabase functions list --project-ref "$PROJECT_REF" --output json | jq -r '.[].name')

echo "Detected functions:"
echo "$FUNCTIONS"

while read -r fn; do
  if [ -n "$fn" ]; then
    echo "   - Downloading function: $fn"
    npx supabase functions download "$fn" --project-ref "$PROJECT_REF" --workdir "$FUNCTIONS_DIR" || echo "      ⚠ Failed to download $fn"
  fi
done <<< "$FUNCTIONS"

# ---------------------------------------------------------------------------
# Consolidate all Edge Functions into one file
# ---------------------------------------------------------------------------
echo "🧩 Consolidating all Edge Functions into a single file..."
ALL_FUNCTIONS_FILE="$BACKUP_DIR/all_edge_functions_$DATE.ts"

# Write header
echo "// Consolidated Edge Functions Backup" > "$ALL_FUNCTIONS_FILE"
echo "// Each function/shared module is separated by headers for clarity" >> "$ALL_FUNCTIONS_FILE"

# Helper: append all .ts/.js/.json files under a given directory
append_dir_files() {
  local base_dir="$1"   # root dir to search under
  local label="$2"      # label prefix for the file header
  local out="$3"        # output file

  mapfile -d '' files < <(find "$base_dir" -type f \( -name "*.ts" -o -name "*.js" -o -name "*.json" \) -print0 | sort -z)

  for f in "${files[@]}"; do
    local rel="${f#"$base_dir"/}"
    printf '\n// --- File: %s/%s ---\n\n' "$label" "$rel" >> "$out"
    cat "$f" >> "$out"
    printf '\n' >> "$out"
  done
}

# --- Shared directories first ---
for SHARED_NAME in _shared shared; do
  SHARED_PATH="$FUNCTIONS_DIR/$SHARED_NAME"
  if [ -d "$SHARED_PATH" ]; then
    echo "   📂 Including $SHARED_NAME directory..."
    printf '\n// ============================\n// Shared Files (%s)\n// ============================\n' "$SHARED_NAME" >> "$ALL_FUNCTIONS_FILE"
    append_dir_files "$SHARED_PATH" "$SHARED_NAME" "$ALL_FUNCTIONS_FILE"
    echo "   ✅ $SHARED_NAME files included"
  fi
done

# --- Individual functions ---
while read -r fn; do
  if [ -n "$fn" ]; then
    FUNC_PATH="$FUNCTIONS_DIR/$fn"
    if [ -d "$FUNC_PATH" ]; then
      printf '\n// ============================\n// Function: %s\n// ============================\n' "$fn" >> "$ALL_FUNCTIONS_FILE"
      append_dir_files "$FUNC_PATH" "$fn" "$ALL_FUNCTIONS_FILE"
    else
      echo "   ⚠ Directory not found for function: $fn (skipping)"
    fi
  fi
done <<< "$FUNCTIONS"

echo "✅ Edge Functions backed up and consolidated into $ALL_FUNCTIONS_FILE"
echo "✅ Backup completed. Files saved in $BACKUP_DIR"
echo "✅ Database files saved in $DB_BACKUP_DIR"
