# Local → Production (Supabase)

Repeatable workflow for schema migrations, data changes, and edge functions for project `REDACTED_PROJECT_REF`.

## One-time setup

```bash
npx supabase login
# supabase/.env must contain PROJECT_REF
source supabase/.env
npx supabase link --project-ref "$PROJECT_REF"
```

Optional: disable CLI telemetry if you hit permission errors on `~/.supabase/telemetry.json`:

```bash
export SUPABASE_TELEMETRY=false
```

## Day-to-day local development

1. Start local stack: `npx supabase start`
2. Make schema changes locally (SQL editor, migrations, or `supabase db query` against local)
3. **Never** run `supabase db pull` straight to `migrations/` without reviewing — it can generate reversions (see `20260519155036_remote_schema.sql`)
4. When schema is stable, capture a migration:

```bash
npx supabase migration new my_change_name
# Edit supabase/migrations/<timestamp>_my_change_name.sql
# Test locally:
npx supabase db reset   # applies all migrations + seed (destructive to local data)
# OR apply only new migrations on running local DB via Studio / query
```

5. Regenerate types after schema changes:

```bash
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
# adjust output path to match your project
```

## Before every production push

### Checklist

- [ ] All changes committed; migration files reviewed (no `DROP` surprises, no debug policies)
- [ ] `./supabase/backup.sh` — fresh prod schema + function backup
- [ ] `npx supabase migration list --linked` — know what prod has vs local files
- [ ] Edge function secrets exist in Dashboard (Stripe, Brevo, Google Maps, Igloohome, etc.)
- [ ] Frontend deployed if it depends on new columns/functions

### Inspect pending migrations

```bash
source supabase/.env
npx supabase migration list --linked
```

**Baseline rule:** `20240101000000_baseline_prod_schema.sql` is a symlink to `prod_schema.sql`. Production already matches it. If prod shows baseline as **not applied**, repair once (do not re-run the SQL):

```bash
npx supabase migration repair --status applied 20240101000000
```

### Dry-run diff (optional)

After local matches what you want:

```bash
npx supabase db diff --linked
```

Empty output ≈ prod matches local migration state. Non-empty → you may need another migration file before push.

## Production schema push

```bash
source supabase/.env
npx supabase link --project-ref "$PROJECT_REF"
./supabase/backup.sh
npx supabase db push --linked
npx supabase migration list --linked   # all should show applied
```

### Data-only changes (no DDL)

Prefer idempotent SQL in a migration (e.g. `UPDATE ... WHERE`, `INSERT ... ON CONFLICT`):

```bash
npx supabase migration new seed_or_fix_data
# edit SQL, then db push --linked
```

Avoid manual Dashboard SQL for changes you want reproducible.

## Production edge functions

Deploy **after** schema when functions depend on new tables/columns.

```bash
# All functions in supabase/functions/ (except _shared)
npx supabase functions deploy --project-ref "$PROJECT_REF"
```

Deploy a single function:

```bash
npx supabase functions deploy finalize-booking --project-ref "$PROJECT_REF"
```

Secrets: Dashboard → Edge Functions → Secrets (not committed to git).

JWT: only use `--no-verify-jwt` for webhooks or endpoints that validate auth internally (e.g. `stripe-webhook`).

## Smoke tests (production)

- Guest booking → `pending_customers` → verify email → payment
- Verification document upload (`verification-documents` bucket)
- Customer portal magic link
- Stripe test payment + webhook
- Admin login

## Rollback

| What | How |
|------|-----|
| Functions | Redeploy from `supabase/backups/functions_<date>/` or `push_backup.sh` |
| Schema | Supabase point-in-time recovery (if enabled) or restore from `backups/db/schema_*.sql` |
| Migration history | `migration repair` fixes tracking only; does not undo SQL |

## Making the next push smoother

1. **Always use named migrations** — `supabase migration new <name>`; avoid editing prod via Dashboard without a migration file.
2. **Do not commit `db pull` output blindly** — diff against your intentional local changes first.
3. **Keep baseline repaired on prod** — baseline is “prod as-of date X”; new work goes in timestamped migrations only.
4. **Run `backup.sh` before every prod push** — automatic rollback reference.
5. **One migration per logical change** — tax, storage, data seed separate (easier to review and revert).
6. **Commit `supabase gen types`** after schema changes so frontend stays in sync.
7. **Document new secrets** in this file or a secrets checklist when adding functions.

## Migration chain (current)

| Version | File | Purpose |
|---------|------|---------|
| 20240101000000 | baseline → prod_schema.sql | Prod snapshot (repair as applied on prod) |
| 20260518120000 | tax_plumbing | Tax columns, cache, RPCs |
| 20260518130000 | verification_storage_policies | Verification bucket RLS |
| 20260519120000 | sync_insurance_pricing | Insurance $25 data |
| 20260519155036 | remote_schema | Prod pull (includes reversions — later migrations fix) |
| 20260520120000 | restore_tax_flags | Per-line tax flags |
| 20260520130000 | seed_driveway_protection_price | Settings seed |
| 20260520140000 | restore_tax_plumbing | Re-apply tax plumbing after remote_schema |
| 20260520150000 | fix_verification_storage | Remove debug storage; restore scoped policies |

## Deploy all functions (resilient to esm.sh blips)

Bulk deploy can fail if `esm.sh` returns 522. Deploy one-by-one:

```bash
source supabase/.env
for fn in $(ls supabase/functions | grep -v '^_'); do
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF" || echo "FAILED: $fn"
done
```

Then retry any `FAILED` lines.
