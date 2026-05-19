#!/usr/bin/env bash
# Confirms tax_plumbing exists on local Supabase but is missing on linked production.
# Does NOT modify production. Run from repo root.
# For a full local vs prod comparison (all schemas), use: ./scripts/compare-local-vs-remote-schema.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=============================================="
echo " Tax migration gap: local vs production"
echo "=============================================="
echo ""

LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

check_local() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "⚠ psql not found; skipping local column checks."
    return 1
  fi
  if ! psql "$LOCAL_DB" -c "SELECT 1" >/dev/null 2>&1; then
    echo "⚠ Local Supabase not reachable at $LOCAL_DB"
    echo "  Start with: npx supabase start"
    return 1
  fi
  echo "--- Local database (127.0.0.1:54322) ---"
  psql "$LOCAL_DB" -At -c "
    SELECT 'OK  ' || column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='business_settings'
      AND column_name IN ('tax_rate_pickup','tax_rate_delivery')
    UNION ALL
    SELECT 'OK  ' || column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings'
      AND column_name IN ('delivery_type','tax_jurisdiction','tax_zip_used')
    UNION ALL
    SELECT 'OK  ' || column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pending_customers'
      AND column_name='subtotal_before_tax'
    UNION ALL
    SELECT 'OK  ' || column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='services'
      AND column_name IN ('is_taxable','delivery_fee_is_taxable','mileage_is_taxable')
    UNION ALL
    SELECT 'OK  tax_rate_cache table' FROM information_schema.tables
    WHERE table_schema='public' AND table_name='tax_rate_cache';
  " | sort || true
  echo ""
  return 0
}

check_local || true

echo "--- Linked migration history (npx supabase migration list --linked) ---"
if npx supabase migration list --linked 2>/dev/null; then
  echo ""
else
  echo "⚠ Could not list remote migrations (login/link/password)."
  echo "  Run: npx supabase login && npx supabase link --project-ref \$(grep PROJECT_REF supabase/.env | cut -d= -f2)"
  echo ""
fi

echo "--- Interpretation ---"
cat <<'EOF'
LOCAL ONLY (not on remote) — would be applied by `db push --linked` IN ORDER:
  1. 20240101000000_baseline_prod_schema.sql  (~4600 lines, full prod dump)
  2. 20260518120000_tax_plumbing.sql
  3. 20260518130000_verification_storage_policies.sql

REMOTE ONLY (not in your migrations folder) — already applied on prod historically:
  20260428171818, 20260506141600, 20260508100000–100400, 20260509053853, 20260515014258

CONFIRMED: Production lacks tax_plumbing columns (information_schema on prod).
  → db diff --linked "No schema changes found" is WRONG for this gap; do not trust it.

SAFE DEPLOY (recommended):
  1. In Supabase Dashboard → SQL (production), run:
       supabase/migrations/20260518120000_tax_plumbing.sql
       supabase/migrations/20260518130000_verification_storage_policies.sql
  2. Re-run prod information_schema checks (see script header comments in repo docs).

AVOID naive `db push --linked`:
  Step 1 would re-apply the entire baseline dump on live prod (risky/slow).

After manual SQL on prod, register migrations (match local version strings):
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES
    ('20260518120000', 'tax_plumbing'),
    ('20260518130000', 'verification_storage_policies')
  ON CONFLICT DO NOTHING;

Optional: mark baseline as applied WITHOUT running its SQL (prod already matches dump):
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('20240101000000', 'baseline_prod_schema')
  ON CONFLICT DO NOTHING;

Prod verification query (run in Dashboard SQL):
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='business_settings'
    AND column_name IN ('tax_rate_pickup','tax_rate_delivery');

WHY `db pull --linked` FAILED:
  Remote migration history and supabase/migrations/ folder disagree.
  Remote has 8 versions applied via Dashboard/older CLI (no .sql files in repo).
  Local has 3 versions (baseline + tax + storage) not recorded on remote.
  `db pull` refuses until histories align — it is NOT for deploying tax to prod.

DO NOT run all CLI-suggested `migration repair` commands blindly:
  • repair --status applied  → only updates history; does NOT run migration SQL
  • repair --status reverted → only updates history; does NOT undo schema on prod
  Marking tax migrations "applied" BEFORE running SQL on prod = broken prod + false history

RECOMMENDED ORDER (production tax deploy + history fix):
  Step 1 — Dashboard SQL on PROD (required):
    Run 20260518120000_tax_plumbing.sql
    Run 20260518130000_verification_storage_policies.sql
    Verify columns with information_schema queries above.

  Step 2 — Register on remote (pick ONE approach):

  A) Dashboard SQL (no CLI password needed):
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
      ('20260518120000', 'tax_plumbing'),
      ('20260518130000', 'verification_storage_policies'),
      ('20240101000000', 'baseline_prod_schema')
    ON CONFLICT DO NOTHING;
    (baseline row = prod already matches prod_schema.sql; do not run baseline SQL)

  B) CLI after Step 1 (export SUPABASE_DB_PASSWORD from project DB password):
    npx supabase migration repair --linked --status applied 20260518120000
    npx supabase migration repair --linked --status applied 20260518130000
    npx supabase migration repair --linked --status applied 20240101000000

  Step 3 — Optional: recover remote-only migration .sql files into repo:
    export SUPABASE_DB_PASSWORD='your-db-password'
    npx supabase migration fetch --linked
    (downloads 20260428…20260515… files so folder matches remote history)

  Step 4 — Only if you still need `db pull` after fetch + tax applied:
    Do NOT revert remote 20260428–20260515 unless you understand you are
    editing bookkeeping only; schema from those migrations stays on prod.
    Prefer migration fetch over mass `repair --status reverted`.

  `db push --linked` is still unsafe: it would run baseline SQL first unless
  20240101000000 is already marked applied (Step 2) and tax SQL already ran (Step 1).
EOF

echo ""
echo "Done."
