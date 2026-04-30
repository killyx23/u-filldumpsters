#!/usr/bin/env bash
# =============================================================================
# push_backups.sh
#
# Usage:
#   ./push_backups.sh <datetime> [function1 function2 ...]
#
# Examples:
#   # Deploy ALL functions from a backup snapshot
#   ./push_backups.sh 2026-03-27_00-17-26
#
#   # Deploy specific functions from a backup snapshot
#   ./push_backups.sh 2026-03-27_00-17-26 finalize-booking send-booking-confirmation
#
# The datetime argument must match a folder under supabase/backups/
# in the format: functions_YYYY-MM-DD_HH-MM-SS
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Validate arguments
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  error "No datetime provided."
  echo ""
  echo "Usage: $0 <datetime> [function1 function2 ...]"
  echo "Example: $0 2026-03-27_00-17-26"
  echo "Example: $0 2026-03-27_00-17-26 finalize-booking"
  exit 1
fi

DATETIME="$1"
shift  # remaining args (if any) are function names

# ---------------------------------------------------------------------------
# Resolve paths relative to this script's location
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$SCRIPT_DIR"
BACKUP_DIR="$SUPABASE_DIR/backups/functions_${DATETIME}"
STAGING_DIR="$SUPABASE_DIR/functions"

# ---------------------------------------------------------------------------
# Validate backup folder exists
# ---------------------------------------------------------------------------
if [[ ! -d "$BACKUP_DIR" ]]; then
  error "Backup folder not found: $BACKUP_DIR"
  echo ""
  echo "Available backups:"
  ls "$SUPABASE_DIR/backups/" 2>/dev/null | grep "^functions_" || echo "  (none found)"
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine which functions to deploy
# ---------------------------------------------------------------------------
if [[ $# -gt 0 ]]; then
  # Specific functions provided as arguments
  FUNCTIONS=("$@")
  info "Deploying specific functions: ${FUNCTIONS[*]}"
else
  # No functions specified — deploy everything in the backup folder
  mapfile -t FUNCTIONS < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \;)
  if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
    error "No function folders found inside $BACKUP_DIR"
    exit 1
  fi
  info "No functions specified — deploying all: ${FUNCTIONS[*]}"
fi

# ---------------------------------------------------------------------------
# Validate that every requested function exists in the backup
# ---------------------------------------------------------------------------
MISSING=()
for fn in "${FUNCTIONS[@]}"; do
  if [[ ! -d "$BACKUP_DIR/$fn" ]]; then
    MISSING+=("$fn")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  error "The following functions were not found in $BACKUP_DIR:"
  for fn in "${MISSING[@]}"; do
    echo "  - $fn"
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# Ensure staging directory exists
# ---------------------------------------------------------------------------
mkdir -p "$STAGING_DIR"

# ---------------------------------------------------------------------------
# Copy functions into staging
# ---------------------------------------------------------------------------
echo ""
info "Copying functions into staging: $STAGING_DIR"
for fn in "${FUNCTIONS[@]}"; do
  SRC="$BACKUP_DIR/$fn/supabase/functions/$fn"
  DEST="$STAGING_DIR/$fn"
  info "  Copying $fn …"
  rm -rf "$DEST"
  cp -r "$SRC" "$DEST"
  success "  $fn staged."
done

# ---------------------------------------------------------------------------
# Deploy each function via Supabase CLI
# ---------------------------------------------------------------------------
echo ""
info "Deploying functions via Supabase CLI …"
FAILED=()
for fn in "${FUNCTIONS[@]}"; do
  info "  Deploying $fn …"
  if (cd "$SCRIPT_DIR/.." && npx supabase functions deploy "$fn" --no-verify-jwt); then
    success "  $fn deployed successfully."
  else
    error "  $fn deployment FAILED."
    FAILED+=("$fn")
  fi
done

# ---------------------------------------------------------------------------
# Clean up staging — only remove what we staged, leave everything else
# ---------------------------------------------------------------------------
echo ""
info "Cleaning up staging folder …"
for fn in "${FUNCTIONS[@]}"; do
  # Only delete if deployment succeeded
  if [[ ! " ${FAILED[*]} " =~ " ${fn} " ]]; then
    rm -rf "$STAGING_DIR/$fn"
    info "  Removed $fn from staging."
  else
    warn "  Leaving $fn in staging (deployment failed — inspect manually)."
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================="
echo "       DEPLOYMENT SUMMARY     "
echo "=============================="
DEPLOYED=()
for fn in "${FUNCTIONS[@]}"; do
  if [[ ! " ${FAILED[*]} " =~ " ${fn} " ]]; then
    DEPLOYED+=("$fn")
    echo -e "  ${GREEN}✓${NC} $fn"
  else
    echo -e "  ${RED}✗${NC} $fn  (FAILED)"
  fi
done
echo "=============================="
echo ""

if [[ ${#FAILED[@]} -gt 0 ]]; then
  error "${#FAILED[@]} function(s) failed to deploy. Backup preserved at:"
  echo "  $BACKUP_DIR"
  exit 1
else
  success "All ${#DEPLOYED[@]} function(s) deployed successfully."
  info "Backup preserved at: $BACKUP_DIR"
fi