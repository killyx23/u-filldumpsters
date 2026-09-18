# Supabase backups

Scripts for backing up the linked remote (production) project and restoring edge functions.

## Prerequisites

From the repo root:

```bash
npx supabase login
# PROJECT_REF is in supabase/.env
npx supabase link --project-ref <PROJECT_REF>
```

`backup.sh` sources `supabase/.env` and re-links using `$PROJECT_REF`.

## Backup (`./supabase/backup.sh`)

### Schema + edge functions (default)

```bash
./supabase/backup.sh
```

Writes:

- `supabase/backups/db/schema_<timestamp>.sql` — schema only (tables, policies, functions, etc.)
- `supabase/backups/functions_<timestamp>/` — downloaded edge functions
- `supabase/backups/all_edge_functions_<timestamp>.ts` — consolidated functions file

### Include production row data

```bash
./supabase/backup.sh --with-data
```

Also writes:

- `supabase/backups/db/seed_<timestamp>.sql`
- `supabase/backups/db/seed.sql` (same contents; stable name for the latest dump)

These files contain **production PII**. They are listed in `.gitignore` and must never be committed.

### Why not `supabase/seed.sql`?

`config.toml` enables seeding with:

```toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

Anything at `supabase/seed.sql` is loaded automatically on local `supabase db reset` / start. Putting a production dump there previously caused local environment issues. Data dumps therefore live under `supabase/backups/db/` so they are **not** auto-applied.

If you deliberately want to seed local from a dump, copy or apply the file manually — and do not leave a production dump at `supabase/seed.sql` long-term.

## Restore edge functions (`./supabase/push_backup.sh`)

Redeploys functions from a prior backup snapshot. It does **not** restore the database.

```bash
./supabase/push_backup.sh <datetime> [function1 function2 ...]
```

`<datetime>` must match a folder under `supabase/backups/` named `functions_YYYY-MM-DD_HH-MM-SS`.
