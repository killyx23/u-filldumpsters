/**
 * Unit tests for PIN notify / overnight-create window helpers.
 * Mirrors supabase/functions/_shared/pinTiming.ts (Denver calendar + 12h / 1h gates).
 *
 *   node --test tools/test-pin-notify-windows.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Denver";
const PIN_LEAD_MS = 12 * 60 * 60 * 1000;
const PIN_REMINDER_MS = 60 * 60 * 1000;

function denverCalendarDate(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function addCalendarDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isDropOffTodayOrTomorrow(dropOffDate, now) {
  const today = denverCalendarDate(now);
  return dropOffDate === today || dropOffDate === addCalendarDays(today, 1);
}

function isDueForFirstPinNotify(startMs, nowMs) {
  return nowMs >= startMs - PIN_LEAD_MS && nowMs < startMs + 60 * 60 * 1000;
}

function isDueForPinReminder(startMs, nowMs) {
  return nowMs >= startMs - PIN_REMINDER_MS && nowMs < startMs + 15 * 60 * 1000;
}

test("overnight create includes tomorrow's drop-off, not two days out", () => {
  const monday1amDenver = new Date("2026-09-01T07:00:00Z"); // 1am MDT
  const today = denverCalendarDate(monday1amDenver);
  assert.equal(today, "2026-09-01");
  assert.equal(isDropOffTodayOrTomorrow("2026-09-01", monday1amDenver), true);
  assert.equal(isDropOffTodayOrTomorrow("2026-09-02", monday1amDenver), true);
  assert.equal(isDropOffTodayOrTomorrow("2026-09-03", monday1amDenver), false);
});

test("12h first PIN notify opens at drop-off minus 12 hours", () => {
  const dropOff = Date.parse("2026-09-02T14:00:00Z"); // 8am MDT
  const at8pm = Date.parse("2026-09-02T02:00:00Z"); // 8pm MDT previous calendar day
  const at7pm = at8pm - 60 * 60 * 1000;
  assert.equal(isDueForFirstPinNotify(dropOff, at7pm), false);
  assert.equal(isDueForFirstPinNotify(dropOff, at8pm), true);
  assert.equal(isDueForFirstPinNotify(dropOff, dropOff - 3 * 60 * 60 * 1000), true);
});

test("1h reminder opens at drop-off minus 1 hour", () => {
  const dropOff = Date.parse("2026-09-02T14:00:00Z");
  const at2h = dropOff - 2 * 60 * 60 * 1000;
  const at1h = dropOff - 60 * 60 * 1000;
  const at10minAfter = dropOff + 10 * 60 * 1000;
  const at20minAfter = dropOff + 20 * 60 * 1000;
  assert.equal(isDueForPinReminder(dropOff, at2h), false);
  assert.equal(isDueForPinReminder(dropOff, at1h), true);
  assert.equal(isDueForPinReminder(dropOff, at10minAfter), true);
  assert.equal(isDueForPinReminder(dropOff, at20minAfter), false);
});
