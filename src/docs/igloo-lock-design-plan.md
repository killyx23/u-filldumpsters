# Igloo Lock Three-Layer Access Plan

**For review by Erik · Based on the u-filldumpsters codebase**

---

## The Three Layers

| Priority | Layer | Technology | Bridge required? | App required? | Remotely revocable? |
|---|---|---|---|---|---|
| **1 — Primary** | iglooKey link | Bluetooth digital key · `pass.igloohome.co/…` | No | No (Android Chrome) · Yes (iOS) | Yes — server-side, instant |
| **2 — Backup** | Custom 6-digit PIN | Programmed via Igloohome Bridge | Yes | No | Yes — via Bridge delete job |
| **3 — Last resort** | AlgoPIN | Igloohome offline algorithm | No | No | No — expires naturally at end time |

---

## Timing Reference

| Label | Value | What it gates |
|---|---|---|
| `T_drop` | Customer's scheduled pickup time | Credential validity start (− 30 min) |
| `T_return` | Scheduled return time | Credential validity end (+ 1 hr grace) |
| `T_drop − 12h` | 12 hours before pickup | Delivery email window opens |
| `T_drop − 30m` | 30 minutes before pickup | PIN and key link become active on the lock |
| `T_drop − 1h` | 1 hour before pickup | Reminder email / SMS sent |
| `T_return + 1h` | 1 hour after return | All credentials expire |
| `5 AM Denver` | 05:00 MT on pickup day | AlgoPIN last-resort generation |

---

## Flow 1 — Normal Booking

### Step 1 · Booking confirmed and paid
The customer completes checkout. Payment succeeds. Booking status moves to `Confirmed`.

**What happens immediately:**
- A random 6-digit custom PIN is generated and stored in the database (`rental_access_codes`, `pin_type = "bridge_proxied"`, `lock_confirmed_at = null`).
- The system immediately attempts to push that PIN to the physical padlock via the Igloohome Bridge. This is a best-effort first try — the bridge may be offline or the lock out of range.
- If the bridge responds and confirms: `lock_confirmed_at` is stamped. **The system stops retrying.** The PIN is ready.
- If not confirmed: the PIN sits in the queue and retries begin (see Step 3).
- No credential is delivered to the customer yet.
- No iglooKey is created yet.

---

### Step 2 · Retry schedule — custom PIN confirmation
Every time the reconciler runs overnight (12 AM – 5 AM Denver), it checks every upcoming booking whose custom PIN is still unconfirmed (`lock_confirmed_at = null`) and retries the bridge push.

The retry cadence accelerates as pickup approaches:

| Time before pickup | How often the system retries |
|---|---|
| More than 2 hours away | Once per hour |
| 2 hours to 1.5 hours out | Every 30 minutes |
| 1.5 hours to 1 hour out | Every 15 minutes |
| 1 hour to 30 minutes out | Every 8 minutes |
| 30 minutes to 5 AM cutoff | Every 4 minutes |

**Once the bridge confirms the PIN at any point during this window:** `lock_confirmed_at` is stamped, the booking is marked confirmed in admin ("PIN confirmed on lock"), and retries stop. If the delivery email has already been sent, nothing else happens. If the delivery email hasn't gone yet (still before `T_drop − 12h`), the email will fire at the normal time.

**Admin view:** Any booking where `pin_generated_at` is set but `lock_confirmed_at` is null shows as "PIN pending" in the admin panel.

---

### Step 3 · 12-hour delivery email (`T_drop − 12h`)
When the reconciler first runs at or after `T_drop − 12h`:

**iglooKey created (Layer 1):**
- An iglooKey is created via the Igloohome API, valid from `T_drop − 30m` to `T_return + 1h`.
- This requires no Bridge and no lock proximity. The key is live the moment the API call succeeds.
- The `pass.igloohome.co/…` link is embedded in the delivery email.

**Delivery email is sent** (once — guarded by `pin_notification_sent_at` so it never duplicates):

> **Subject:** Your U-Fill Dumpsters access is ready — Order #XXXX
>
> **Primary access — tap the link on your phone:**
> [Open your Igloo Key](pass.igloohome.co/…)
> Works on Android (Chrome, no app needed). iPhone users will be prompted to download the Igloo app once.
>
> **Backup PIN — if you prefer to enter a code:**
> `4 8 3 2 9 1`
> Active from [T_drop − 30m] through [T_return + 1h].
>
> Return deadline: [T_return]. Portal link.

If the custom PIN is **not yet bridge-confirmed** at the time the email goes out, the email still shows the custom PIN with a note ("this code will be active once our system syncs with the lock — your key link works now regardless"). Retries continue for the PIN alongside the already-delivered key link.

---

### Step 4 · 1-hour reminder (`T_drop − 1h`)
A second email and SMS go out repeating both the iglooKey link and the custom PIN. Guarded by its own sent flag so it fires exactly once.

---

### Step 5 · 5 AM Denver failsafe — AlgoPIN (pickup day only)
Runs only if, at exactly 5:00 AM Denver on the pickup day:
- The custom PIN is **still not confirmed** on the lock (`lock_confirmed_at = null`), AND
- The customer has **not yet received a PIN email** (`pin_notification_sent_at = null`)

**What happens:**
- An AlgoPIN is generated for the pickup window, using an unused variance slot (1, 2, or 3 — Igloohome allows three simultaneous codes per time window).
- The existing unconfirmed custom PIN row is retired (`status = expired`).
- The delivery email is sent containing:
  - The iglooKey link (created now if not already created, same as Step 3).
  - The AlgoPIN as the backup code, clearly labeled.
- `pin_failsafe_at` is stamped on the booking.
- Admin is alerted: an urgent message appears in the booking's admin chat and a tracking log entry is created: *"Custom PIN for Order #XXXX was not confirmed on the lock before the pickup window. Customer was sent AlgoPIN at 5:00 AM. Review why the lock did not confirm the original code."*

**Admin view:** `pin_failsafe_at` being set shows a visible flag in the admin panel ("AlgoPIN issued — investigate bridge").

---

### Step 6 · Customer picks up
Customer uses whichever access method they prefer (key link, custom PIN, or AlgoPIN). First unlock detected by the bridge and delivered via webhook → booking status moves to `Delivered`, `rented_out_at` is stamped, rental-started email and SMS sent.

---

### Step 7 · Customer returns
Customer drives back, locks up. First lock event inside the return window (`T_return − 2h` onward, after `rented_out_at` is set) → booking status moves to `pending_checklist`, `returned_at` stamped, return confirmation sent.

**All credentials expire at `T_return + 1h`:**
- iglooKey: invalidated server-side via Igloohome API — link stops working immediately.
- Custom PIN: bridge-delete job queued; `rental_access_codes` row marked `expired`; `lock_deleted_at` stamped once bridge confirms. Customer loses portal access immediately.
- AlgoPIN (if used): row expired in DB; the code lives on the physical lock until its natural end time (this is a known, bounded limitation — AlgoPINs cannot be remotely deleted).

---

## Flow 2 — Reschedule

Customer or admin reschedules to a new date and time. All credentials from the old window must be fully revoked before anything new is created.

### Step 1 · Reschedule confirmed
New `T_drop` and `T_return` are stored. Booking returns to `Confirmed` with new dates.

**Revoke all existing credentials immediately:**

| Layer | Action taken |
|---|---|
| iglooKey | Server-side invalidation — link stops working within seconds |
| Custom PIN | `rental_access_codes` row marked `expired` — portal access cut off immediately. Bridge-delete job queued. `lock_deleted_at` stamped when bridge confirms. If bridge offline, cron retries until confirmed. |
| AlgoPIN (if any) | DB row marked `expired` — portal access cut off immediately. Code on physical lock expires naturally. |

`pin_notification_sent_at` and `pin_generated_at` are cleared so the full delivery sequence can fire again for the new dates.

---

### Step 2 · New custom PIN reserved
A new random 6-digit PIN is generated for the new window (`new_T_drop − 30m` → `new_T_return + 1h`). Bridge push attempted immediately. Retry schedule (Step 2 of Flow 1) begins for the new dates.

---

### Step 3 · New iglooKey and delivery email (`new_T_drop − 12h`)
Identical to Flow 1 Step 3, now using the new dates. Delivery email includes a note:

> *"This replaces your previous access codes. Your old key link and PIN no longer work."*

---

### Steps 4–7
Identical to Flow 1 Steps 4–7, all using the new window.

---

## Flow 3 — Extension

Customer extends their rental. `T_return` moves forward. The trailer may or may not still be at the yard.

### Case A — Trailer is still at the yard (not yet picked up)

The bridge can still reach the lock.

**Step 1 · Extension confirmed**
- New `T_return` stored.
- Existing iglooKey invalidated; new iglooKey created for the full extended window (`T_drop − 30m` → `new_T_return + 1h`).
- Existing custom PIN replaced: old PIN deleted from lock via bridge, new random PIN created and pushed for the full extended window.
- Delivery email sent with new iglooKey link + new custom PIN, noting the old codes are replaced.

**Steps 2 onward:** Same as Flow 1 from the delivery email forward.

---

### Case B — Trailer is out in the field (`rented_out_at` is set)

The padlock is away from the yard. **The bridge cannot program new codes on the physical lock.** This is the scenario where iglooKey's bridge-independence is the decisive advantage.

**Step 1 · Extension confirmed**
- New `T_return` stored. Booking stays `Delivered`.

**Step 2 · New iglooKey issued immediately (Layer 1)**
- A new iglooKey is created via API, valid from `now` → `new_T_return + 1h`.
- No bridge needed. The key is live the moment the API call returns.
- This is the primary access method for the extended window.

**Step 3 · AlgoPIN issued as backup (Layer 3)**
- An AlgoPIN is generated immediately for `now` → `new_T_return + 1h`.
- This is the in-field fallback because the bridge cannot reach the padlock.
- If the extended window is longer than 24 hours: `activationRequired = true` — the customer must tap the code once within 24 hours of its start to activate it. This is noted clearly in the email.

**Step 4 · Original custom PIN stays active**
- The original custom PIN remains on the physical lock and continues to work.
- Its `end_time` in the database is updated to `new_T_return + 1h`.
- No new bridge job is created (bridge can't reach the out-of-yard lock). The existing code is the passive bridge-layer backup.

**Step 5 · Extension delivery email**

> **Subject:** Your rental has been extended — Order #XXXX
>
> **New key link (works now, wherever you are):**
> [Open your updated Igloo Key](pass.igloohome.co/…)
>
> **Backup code:**
> `7 2 0 5 1 4` *(if >24h: "Enter once within 24 hours to activate")*
>
> **Your original code may also still work at the lock.**
>
> New return deadline: [new_T_return].

**Step 6 · Return**
Customer returns at `new_T_return`. Same return detection as Flow 1 Step 7. All credentials expire at `new_T_return + 1h`:
- New iglooKey: invalidated server-side.
- AlgoPIN rows: expired in DB; natural lock expiry.
- Original custom PIN: bridge-delete queued when lock returns to yard.

---

## Cancellation and Change — Security Rules

### Trigger conditions
Applies when booking status moves to: `Cancelled`, `cancellation_pending`, `pending_review`, or any other terminal/suspended state.

### Revocation sequence (all three layers, all immediate)

**Layer 1 — iglooKey**
- Server-side invalidation call to Igloohome API.
- Link returns an error the next time the customer taps it. No grace period.

**Layer 2 — Custom PIN**
- `rental_access_codes` row: `status = expired` immediately. Customer loses portal access and cannot see the code.
- Bridge-delete job queued. When the bridge confirms deletion: `lock_deleted_at` stamped.
- If bridge is offline at time of cancellation: cron retries the bridge-delete job on every subsequent run until `lock_deleted_at` is confirmed. The DB row stays expired during this time — the customer has no access — but the physical lock code may still work until the bridge catches up. This retry continues indefinitely until confirmed.

**Layer 3 — AlgoPIN (if one was issued)**
- `rental_access_codes` row: `status = expired` immediately. Customer loses portal access.
- The code **cannot be remotely deleted from the physical lock.** It will continue to work on the padlock until its natural `end_time`. This is an accepted bounded risk: AlgoPINs are always time-limited to the original booking window, so at worst the code works for a few more hours after cancellation.
- Mitigation: if AlgoPINs are issued with a tight end time (not extended beyond the original `T_return + 1h`), the exposure window is small.

### Credential re-creation (if booking is reinstated)
If a booking moves from `pending_review` back to `Confirmed`:
- All three layers are created fresh from scratch following Flow 1 starting at Step 1.
- Old expired rows are never reactivated.

### What the customer retains after cancellation
| Layer | Portal access | Physical lock access |
|---|---|---|
| iglooKey | Revoked immediately | Revoked immediately |
| Custom PIN | Revoked immediately | Revoked when bridge confirms delete (minutes to hours; retried until done) |
| AlgoPIN | Revoked immediately | Works until natural `end_time` (bounded, hours at most) |

---

## Admin Summary Flags

| Field | Meaning |
|---|---|
| `pin_generated_at` set, `lock_confirmed_at` null | Custom PIN is waiting for bridge confirmation — retrying |
| `lock_confirmed_at` set | Custom PIN confirmed on lock — retries stopped |
| `pin_notification_sent_at` set | 12-hour delivery email has been sent |
| `pin_failsafe_at` set | AlgoPIN was issued at 5 AM — investigate why bridge failed |
| `lock_deleted_at` null on expired row | Bridge-delete pending — cron is retrying |