#!/bin/bash
set -e

# Always run from repo root (script may be invoked as ./supabase/backup.sh)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

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
DB_DUMP_OK=false
for attempt in 1 2 3 4 5 ; do
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

# Remove the file if it ended up empty (dump succeeded but returned nothing)
if [ ! -s "$DB_BACKUP_DIR/schema_$DATE.sql" ]; then
  echo "❌ Database dump produced an empty file. Cleaning up and aborting."
  rm -f "$DB_BACKUP_DIR/schema_$DATE.sql"
  exit 1
fi
echo "✅ Database schema saved."

# ---------------------------------------------------------------------------
# Edge Functions — download in parallel
# ---------------------------------------------------------------------------
echo "⚡ Backing up Edge Functions..."
FUNCTIONS_DIR="$BACKUP_DIR/functions_$DATE"
DOWNLOAD_WORKDIR="$BACKUP_DIR/functions_${DATE}_tmp"
mkdir -p "$FUNCTIONS_DIR"
mkdir -p "$DOWNLOAD_WORKDIR"

FUNCTIONS=$(npx supabase functions list --project-ref "$PROJECT_REF" --output json | jq -r '.[].name')

echo "Detected functions:"
echo "$FUNCTIONS"

# ---------------------------------------------------------------------------
# Helper: seed isolated --workdir with link metadata (CLI looks for project ref
# in workdir/supabase/.temp, not only --project-ref when workdir is under backups/)
# ---------------------------------------------------------------------------
prepare_fn_workdir() {
  local workdir="$1"
  if [[ ! -f "$REPO_ROOT/supabase/.temp/project-ref" ]]; then
    echo "   ⚠ No linked project in supabase/.temp — link step may have failed"
    return 1
  fi
  mkdir -p "$workdir/supabase"
  rm -rf "$workdir/supabase/.temp"
  cp -a "$REPO_ROOT/supabase/.temp" "$workdir/supabase/.temp"
  cp "$REPO_ROOT/supabase/config.toml" "$workdir/supabase/config.toml"
}

# ---------------------------------------------------------------------------
# Helper: download a single function into its own isolated subdir
# Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
download_fn() {
  local fn="$1"
  local workdir="$REPO_ROOT/$DOWNLOAD_WORKDIR/$fn"
  mkdir -p "$workdir"
  if ! prepare_fn_workdir "$workdir"; then
    echo "   ⚠ Failed to prepare workdir for $fn"
    return 1
  fi
  if (
    cd "$REPO_ROOT"
    npx supabase functions download "$fn" --project-ref "$PROJECT_REF" --workdir "$workdir"
  ) 2>&1; then
    echo "   ✅ $fn downloaded"
    return 0
  else
    echo "   ⚠ Failed to download $fn"
    return 1
  fi
}
export -f download_fn prepare_fn_workdir
export PROJECT_REF DOWNLOAD_WORKDIR REPO_ROOT

# First pass — parallel (up to 8 at once)
echo "⬇️  Downloading functions in parallel..."
echo "$FUNCTIONS" | xargs -I{} -P8 bash -c 'download_fn "$@"' _ {}

# ---------------------------------------------------------------------------
# Retry pass — serial, for anything that didn't land in the workdir
# (parallel Docker invocations can occasionally race on shared resources)
# ---------------------------------------------------------------------------
echo "🔁 Checking for missing downloads and retrying serially if needed..."
RETRY_LIST=()
while read -r fn; do
  [ -z "$fn" ] && continue
  if [ ! -d "$DOWNLOAD_WORKDIR/$fn" ] || [ -z "$(ls -A "$DOWNLOAD_WORKDIR/$fn" 2>/dev/null)" ]; then
    RETRY_LIST+=("$fn")
  fi
done <<< "$FUNCTIONS"

if [ ${#RETRY_LIST[@]} -gt 0 ]; then
  echo "   Retrying: ${RETRY_LIST[*]}"
  for fn in "${RETRY_LIST[@]}"; do
    download_fn "$fn" || echo "   ❌ $fn failed again after retry"
  done
else
  echo "   All functions downloaded on first pass."
fi

# ---------------------------------------------------------------------------
# Fix ownership before flatten — Supabase CLI downloads via Docker as root
# ---------------------------------------------------------------------------
echo "🔧 Fixing file ownership..."
sudo chown -R "$USER:$USER" "$DOWNLOAD_WORKDIR"

# ---------------------------------------------------------------------------
# Flatten structure: each function was downloaded into its own subdir to avoid
# parallel collisions. Structure is: tmp/<fn>/supabase/functions/<fn>/
# Use cp so new files are owned by current user regardless of Docker ownership.
# Explicitly remove any stray supabase/ wrapper that snuck through.
# ---------------------------------------------------------------------------
echo "📁 Flattening downloaded structure..."
FAILED_DOWNLOADS=()
while read -r fn; do
  [ -z "$fn" ] && continue
  COPIED=false
  for nested in \
    "$DOWNLOAD_WORKDIR/$fn/supabase/functions" \
    "$DOWNLOAD_WORKDIR/$fn/functions"; do
    if [ -d "$nested/$fn" ]; then
      cp -r "$nested/$fn" "$FUNCTIONS_DIR/"
      COPIED=true
      break
    fi
  done
  if [ "$COPIED" = false ]; then
    echo "   ⚠ Could not flatten $fn — may have failed to download"
    FAILED_DOWNLOADS+=("$fn")
  fi
done <<< "$FUNCTIONS"

# Remove any stray supabase/ wrapper dir that may have been copied across
rm -rf "$FUNCTIONS_DIR/supabase"

# Clean up temp workdir
rm -rf "$DOWNLOAD_WORKDIR"

if [ ${#FAILED_DOWNLOADS[@]} -gt 0 ]; then
  echo "⚠ The following functions failed to download: ${FAILED_DOWNLOADS[*]}"
else
  echo "✅ Structure flattened."
fi

# ---------------------------------------------------------------------------
# Consolidate all Edge Functions into one file
# ---------------------------------------------------------------------------
echo "🧩 Consolidating all Edge Functions into a single file..."
ALL_FUNCTIONS_FILE="$BACKUP_DIR/all_edge_functions_$DATE.ts"

echo "// Consolidated Edge Functions Backup" > "$ALL_FUNCTIONS_FILE"
echo "// Each function/shared module is separated by headers for clarity" >> "$ALL_FUNCTIONS_FILE"

append_dir_files() {
  local base_dir="$1"
  local label="$2"
  local out="$3"

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
