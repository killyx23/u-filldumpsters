# Igloohome Webhook — Local Setup & Ops Guide

Tracks lock/unlock state on rented equipment in real time via the `igloohome-webhook`
edge function, with the 5-minute `sync-lock-activity` poller as a fallback.

## What it does

| Event type | Name | Effect |
|---|---|---|
| 5 | Activity Log Received | Primary. Records lock / unlock / break-in; updates device presence; drives rental state machine |
| 10 | Bridge Connection | Updates bridge online/offline; alerts if lock was left open |
| 3 | Job Complete | Upserts `lock_jobs` (result of commands we sent) |

**Presence meanings** (from `lock_device_presence` view):

- `on_premises` — last event was a lock
- `off_premises` — last event was an unlock
- `alert_open_and_offline` — unlocked when the bridge went offline
- `unknown` — no access events yet

Booking lifecycle is unchanged: unlock → `rented_out_at` + rental-started email/SMS;
lock at/after scheduled end → `returned_at` + return confirmation.

## Start local stack (correct order)

Pin the CLI to **2.98.x** for local work. `npx supabase` without a version can pull
2.111+, which currently fails here with `Effect.tryPromise` / `unexpected EOF`
when starting or serving functions.

```bash
# 1. Core Supabase (Postgres, Auth, Kong, Studio, …)
npx --yes supabase@2.98.2 start

# 2. Apply pending migrations (includes lock_* tables)
npx --yes supabase@2.98.2 db push --local

# 3. Point .env.local + supabase/functions/.env at this local instance
npm run supabase:sync-local-env

# 4. Edge functions (separate process — leave this running)
npx --yes supabase@2.98.2 functions serve --env-file supabase/functions/.env

# 5. Frontend (separate process)
npm run dev
```

Shortcut for steps 1 + 3: `npm run dev:backend` (also prefer pinning the CLI inside
that script if you hit the 2.111 errors).

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Lock test lab | http://localhost:3000/admin/lock-test |
| Edge functions | http://127.0.0.1:55421/functions/v1/<name> |
| Webhook (local) | http://127.0.0.1:55421/functions/v1/igloohome-webhook |
| Studio | http://127.0.0.1:55423 |
| API | http://127.0.0.1:55421 |

Verify new tables after migrations:

```bash
docker exec supabase_db_u-filldumpsters psql -U postgres -d postgres \
  -c '\dt public.lock_*' \
  -c 'SELECT * FROM public.lock_device_presence;'
```

## Env vars (`supabase/functions/.env`)

Already used for PIN / OAuth:

```
IGLOOHOME_CLIENT_ID=
IGLOOHOME_CLIENT_SECRET=
IGLOOHOME_LOCK_ID=          # or IGLOOHOME_DEVICE_ID
IGLOOHOME_BRIDGE_ID=
```

Webhook credentials:

```
# RSA public key from igloohome (base64 DER PKCS#1 RSA-2048).
# Not self-serve — request from: dev+support@igloocompany.co
IGLOOHOME_PUBLIC_KEY=

# Local testing only — accept unsigned posts (simulate_webhook cannot forge RSA)
IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED=true

# Optional: break-in / bridge-offline alerts (defaults to BREVO_FROM_EMAIL)
LOCK_ALERT_EMAIL=
```

Production: set the same keys in **Supabase Dashboard → Edge Function secrets**.
Never commit real secrets. Keep `IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED=false` in prod.

## Portal registration (production)

1. Deploy with JWT verification off (igloohome signs with `x-igloocompany-sha256`, not a JWT):

```bash
npx supabase functions deploy igloohome-webhook --no-verify-jwt
npx supabase db push   # or migration deploy for hosted
```

2. In iglooaccess / igloohome portal, add webhook URL:

```
https://<project-ref>.supabase.co/functions/v1/igloohome-webhook
```

Subscribe to **Activity Log Received (5)**, **Bridge Connection (10)**, and **Job Complete (3)**.

3. Put `IGLOOHOME_PUBLIC_KEY` in Edge Function secrets.

Local config already sets this in `supabase/config.toml`:

```toml
[functions.igloohome-webhook]
verify_jwt = false
```

## How to test without the physical lock

1. Open http://localhost:3000/admin/lock-test
2. Enter a self-pickup booking id → **Setup + AlgoPIN** (or bridge PIN)
3. Use the webhook buttons:
   - **Webhook: Unlock (logType 50)** — marks rented when PIN matches
   - **Webhook: Lock (logType 49)** — marks returned at/after scheduled end
   - **Webhook: Break-in (logType 53)** — stores security event + admin alert
4. Refresh **Lock & equipment status** — presence should flip between on/off premises

Offline unit checks (no Supabase required):

```bash
npm run test:igloohome
```

## Architecture (files)

| Path | Role |
|---|---|
| `supabase/functions/igloohome-webhook/` | Public webhook receiver |
| `supabase/functions/sync-lock-activity/` | 5-min poller fallback (same device tracking) |
| `supabase/functions/test-lock-lifecycle/` | Admin test lab + `simulate_webhook` |
| `supabase/functions/_shared/iglooWebhookAuth.ts` | Signature verify (RSA or HMAC) |
| `supabase/functions/_shared/iglooActivity.ts` | Parse `logType` / `entryDate` |
| `supabase/functions/_shared/lockDeviceState.ts` | Device presence ledger |
| `supabase/functions/_shared/lockEventState.ts` | Booking rented/returned machine |
| `supabase/functions/_shared/lockAlerts.ts` | Break-in / bridge-offline emails |
| `supabase/migrations/20260806230000_igloohome_device_events.sql` | Tables + presence view |
| `src/components/admin/LockPresencePanel.jsx` | Admin presence UI |

### Tables

- `lock_devices` — current lock state (`locked` / `unlocked` / `unknown`)
- `lock_bridges` — bridge online/offline
- `lock_device_events` — raw activity (PINs redacted from `raw`)
- `lock_jobs` — job-complete results
- `lock_device_presence` — reporting view for admin UI
- `rental_tracking_logs` — booking-scoped timeline (unchanged; may include `breakin`)

## Troubleshooting

| Symptom | Fix |
|---|---|
| Webhook returns 401 | Signature failed. Check `IGLOOHOME_PUBLIC_KEY` matches igloohome's key; failure logs include the configured public key and signed-string candidates |
| Gateway 401 before your code | Deploy/serve with `verify_jwt = false` / `--no-verify-jwt` |
| Events stored but booking not updated | PIN did not match an active `rental_access_codes` row — run Setup first |
| Presence stuck on `unknown` | No type-5 activity yet — use Simulate Webhook or Sync Lock Activity |
| `SUPABASE_*` skipped when serving | Normal — the CLI injects those; other keys still load from `--env-file` |
| `simulate_webhook` hangs then UI shows Function not found / remote project-ref | Old flow self-fetched the webhook inside the edge runtime (deadlock). Pull latest — simulate is in-process now. The project-ref text was only deploy help, not a remote call. |

## Production checklist

- [ ] Migration applied on hosted DB
- [ ] `igloohome-webhook` deployed with `--no-verify-jwt`
- [ ] `IGLOOHOME_PUBLIC_KEY` set in Edge Function secrets
- [ ] `IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED` **not** true in production
- [ ] Webhook URL registered for events 3, 5, and 10
- [ ] End-to-end test: unlock with booking PIN → rental started; lock after end → returned
- [ ] Confirm break-in alert email arrives when testing logType 53
