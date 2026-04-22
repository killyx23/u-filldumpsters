#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="supabase/backups"
PROJECT_SUPABASE_DIR="supabase"
PROJECT_FUNCTIONS_DIR="$PROJECT_SUPABASE_DIR/functions"
STAGING_BASE_DIR="$PROJECT_SUPABASE_DIR/staging_restore_push"
SUPABASE_CLI=(npx supabase)

usage() {
  cat <<'EOF'
Usage:
  supabase/push_backup.sh --date <YYYY-MM-DD_HH-MM-SS> [--function <name>] [--dry-run]
  supabase/push_backup.sh --folder <path-to-functions_backup_folder> [--function <name>] [--dry-run]
  supabase/push_backup.sh --staging <path-to-staging-workdir> [--function <name>] [--dry-run]

Examples:
  ./supabase/push_backup.sh --date 2026-04-15_11-09-20 --function verify-address
  ./supabase/push_backup.sh --date 2026-04-15_11-09-20
  ./supabase/push_backup.sh --folder supabase/backups/functions_2026-04-15_11-09-20 --dry-run
  ./supabase/push_backup.sh --staging supabase/staging_restore_push/2026-04-22_02-17-17 --function verify-address

Notes:
  - If --function is omitted, all functions in the backup folder are deployed.
  - This script stages files into a persistent folder you can inspect:
      supabase/staging_restore_push/<run-id>/supabase/functions/<function-name>/...
    and deploys explicitly from that folder using `npx supabase ... --workdir <staging>`.
  - Backups under supabase/backups are never modified.
  - Requires: npx, supabase CLI (via npx), and a PROJECT_REF env var (or supabase/.env containing PROJECT_REF).
EOF
}

DATE=""
FOLDER=""
STAGING_INPUT=""
FUNCTION_NAME=""
DRY_RUN="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="${2:-}"; shift 2;;
    --folder)
      FOLDER="${2:-}"; shift 2;;
    --staging)
      STAGING_INPUT="${2:-}"; shift 2;;
    --function|-f)
      FUNCTION_NAME="${2:-}"; shift 2;;
    --dry-run)
      DRY_RUN="1"; shift 1;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2;;
  esac
done

# Load PROJECT_REF from dotenv files if present.
# Prefer `supabase/.env` (matches backup.sh), then fall back to root `.env`.
if [[ -z "${PROJECT_REF:-}" ]]; then
  if [[ -f "supabase/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "supabase/.env"
    set +a
  elif [[ -f ".env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source ".env"
    set +a
  fi
fi

if [[ -z "${PROJECT_REF:-}" ]]; then
  echo "PROJECT_REF is not set." >&2
  echo "Set it in your shell, or add PROJECT_REF=... to either supabase/.env (preferred) or .env" >&2
  exit 1
fi

if [[ -n "$DATE" && -n "$FOLDER" ]]; then
  echo "Use only one of --date or --folder." >&2
  exit 2
fi

if [[ -n "$STAGING_INPUT" && ( -n "$DATE" || -n "$FOLDER" ) ]]; then
  echo "When using --staging, do not use --date or --folder." >&2
  exit 2
fi

if [[ -n "$STAGING_INPUT" ]]; then
  if [[ ! -d "$STAGING_INPUT" ]]; then
    echo "Staging folder not found: $STAGING_INPUT" >&2
    exit 1
  fi
  STAGING_DIR="$STAGING_INPUT"
  FOLDER=""
elif [[ -z "$FOLDER" ]]; then
  if [[ -z "$DATE" ]]; then
    echo "Missing --date or --folder." >&2
    echo "" >&2
    echo "Available backups:" >&2
    ls -1 "$BACKUP_DIR" 2>/dev/null | sed -n 's/^functions_//p' | sort -r | head -n 30 >&2 || true
    exit 2
  fi
  FOLDER="$BACKUP_DIR/functions_$DATE"
fi

if [[ -n "$FOLDER" ]]; then
  if [[ ! -d "$FOLDER" ]]; then
    echo "Backup folder not found: $FOLDER" >&2
    exit 1
  fi
fi

mkdir -p "$PROJECT_FUNCTIONS_DIR"

TMP_BASE="supabase/.push_backup_tmp"
RUN_ID="$(date +"%Y-%m-%d_%H-%M-%S")"
TMP_RUN_DIR="$TMP_BASE/$RUN_ID"
TMP_PREV_DIR="$TMP_RUN_DIR/previous_functions"
mkdir -p "$TMP_PREV_DIR"

if [[ -z "${STAGING_DIR:-}" ]]; then
  STAGING_DIR="$STAGING_BASE_DIR/$RUN_ID"
  mkdir -p "$STAGING_DIR/supabase/functions"
fi

discover_functions() {
  if [[ -n "$FOLDER" ]]; then
  # Top-level directories under the backup folder are the function names.
  # Each should contain: <fn>/supabase/functions/<fn>/...
  (cd "$FOLDER" && ls -1) | while read -r fn; do
    [[ -z "$fn" ]] && continue
    [[ "$fn" == .* ]] && continue
    [[ -d "$FOLDER/$fn" ]] || continue
    echo "$fn"
  done
  else
    (cd "$STAGING_DIR/supabase/functions" && ls -1) | while read -r fn; do
      [[ -z "$fn" ]] && continue
      [[ "$fn" == .* ]] && continue
      [[ -d "$STAGING_DIR/supabase/functions/$fn" ]] || continue
      echo "$fn"
    done
  fi
}

copy_one_function_into_staging() {
  local fn="$1"
  local src="$FOLDER/$fn/supabase/functions/$fn"
  local dst="$PROJECT_FUNCTIONS_DIR/$fn"
  local prev="$TMP_PREV_DIR/$fn"
  local staged_dst="$STAGING_DIR/supabase/functions/$fn"

  if [[ ! -d "$src" ]]; then
    echo "Backup for function '$fn' not found at: $src" >&2
    return 1
  fi

  echo "Staging '$fn'"
  echo "  - from: $src"
  echo "  - to (workdir): $staged_dst"
  echo "  - to (standard): $dst"

  rm -rf "$staged_dst"
  mkdir -p "$staged_dst"
  cp -R "$src/." "$staged_dst"

  if [[ -d "$dst" ]]; then
    rm -rf "$prev"
    mkdir -p "$prev"
    cp -R "$dst/." "$prev"
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -R "$src/." "$dst"
}

restore_one_function_from_prev_or_clean() {
  local fn="$1"
  local dst="$PROJECT_FUNCTIONS_DIR/$fn"
  local prev="$TMP_PREV_DIR/$fn"

  if [[ -d "$prev" ]]; then
    rm -rf "$dst"
    mkdir -p "$dst"
    cp -R "$prev/." "$dst"
  else
    rm -rf "$dst"
  fi
}

cleanup_tmp() {
  rm -rf "$TMP_RUN_DIR" || true
}

deploy_one_function_from_project() {
  local fn="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] Would deploy: $fn"
    echo "  - project-ref: $PROJECT_REF"
    echo "  - workdir: $STAGING_DIR"
    if [[ -f "$STAGING_DIR/supabase/functions/$fn/index.ts" ]]; then
      echo "  - staged index.ts sha256: $(sha256sum "$STAGING_DIR/supabase/functions/$fn/index.ts" | awk '{print $1}')"
    fi
    return 0
  fi

  echo "Deploying function: $fn"
  if [[ -f "$STAGING_DIR/supabase/functions/$fn/index.ts" ]]; then
    echo "  - staged index.ts sha256: $(sha256sum "$STAGING_DIR/supabase/functions/$fn/index.ts" | awk '{print $1}')"
  fi
  "${SUPABASE_CLI[@]}" functions deploy "$fn" --project-ref "$PROJECT_REF" --workdir "$STAGING_DIR"
}

print_supabase_debug() {
  echo "Supabase CLI:"
  "${SUPABASE_CLI[@]}" --version 2>&1 || true
  echo "Project ref: $PROJECT_REF"
  echo "Repo root: $ROOT_DIR"
  echo "Backup folder: ${FOLDER:-<none>}"
  echo "Staging folder: $STAGING_DIR"
  echo "Standard folder (also written): $PROJECT_FUNCTIONS_DIR"
  echo ""
  echo "If deploy fails due to auth/linking, run:"
  echo "  npx supabase login"
  echo "  npx supabase link --project-ref $PROJECT_REF"
  echo ""
  echo "Current remote functions (best-effort):"
  "${SUPABASE_CLI[@]}" functions list --project-ref "$PROJECT_REF" 2>&1 || true
  echo ""
}

echo "Using backup folder: $FOLDER"
echo "Staging into (persistent): $STAGING_DIR"
echo "Also writing standard: $PROJECT_FUNCTIONS_DIR"
print_supabase_debug

trap 'set +e; if [[ -n "${FUNCS_TO_RESTORE:-}" ]]; then for fn in $FUNCS_TO_RESTORE; do restore_one_function_from_prev_or_clean "$fn"; done; fi; cleanup_tmp' EXIT

if [[ -n "$FUNCTION_NAME" ]]; then
  echo "Restoring single function: $FUNCTION_NAME"
  FUNCS_TO_RESTORE="$FUNCTION_NAME"
  if [[ -n "$FOLDER" ]]; then
    copy_one_function_into_staging "$FUNCTION_NAME"
  else
    echo "Using existing staged function at: $STAGING_DIR/supabase/functions/$FUNCTION_NAME"
  fi
  deploy_one_function_from_project "$FUNCTION_NAME"
  echo ""
  echo "Remote functions after deploy (best-effort):"
  "${SUPABASE_CLI[@]}" functions list --project-ref "$PROJECT_REF" || true
else
  echo "Restoring all functions..."
  mapfile -t FUNCS < <(discover_functions)
  if [[ "${#FUNCS[@]}" -eq 0 ]]; then
    echo "No functions found." >&2
    exit 1
  fi

  FUNCS_TO_RESTORE="${FUNCS[*]}"
  if [[ -n "$FOLDER" ]]; then
    for fn in "${FUNCS[@]}"; do
      copy_one_function_into_staging "$fn"
    done
  else
    echo "Using existing staged functions at: $STAGING_DIR/supabase/functions"
  fi

  for fn in "${FUNCS[@]}"; do
    deploy_one_function_from_project "$fn"
  done

  echo ""
  echo "Remote functions after deploy (best-effort):"
  "${SUPABASE_CLI[@]}" functions list --project-ref "$PROJECT_REF" || true
fi

echo "Done."
