/**
 * Offline checks for iglooKey matching + return-window helpers.
 *
 *   node --test tools/test-lock-key-matching.mjs
 *   npm run test:lock-key-matching
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Deno = { env: { get: () => undefined } };

async function importBundled(relPath) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, relPath)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    packages: "external",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const activity = await importBundled("supabase/functions/_shared/iglooActivity.ts");
const lockState = await importBundled("supabase/functions/_shared/lockEventState.ts");
const bridge = await importBundled("supabase/functions/_shared/bridgeReturnConfirm.ts");

test("parseActivityLogEntry extracts tokenId as keyId", () => {
  const parsed = activity.parseActivityLogEntry({
    logType: 11,
    entryDate: 1_700_000_000,
    tokenId: "lnk_abc123",
  });
  assert.equal(parsed?.eventType, "unlock");
  assert.equal(parsed?.keyId, "lnk_abc123");
});

test("parseActivityLogEntry keeps numeric keyId", () => {
  const parsed = activity.parseActivityLogEntry({
    logType: 11,
    entryDate: 1_700_000_000,
    keyId: 12847,
  });
  assert.equal(parsed?.keyId, "12847");
});

test("isUsableAccessKeyId rejects admin/remote/zero", () => {
  assert.equal(lockState.isUsableAccessKeyId(null), false);
  assert.equal(lockState.isUsableAccessKeyId("0"), false);
  assert.equal(lockState.isUsableAccessKeyId("remote-unlock"), false);
  assert.equal(lockState.isUsableAccessKeyId("remote-lock"), false);
  assert.equal(lockState.isUsableAccessKeyId("lnk_abc"), true);
  assert.equal(lockState.isUsableAccessKeyId("12847"), true);
});

test("closeCountsAsReturn opens two hours before due", () => {
  const endMs = Date.parse("2026-11-11T06:00:00.000Z");
  const twoHoursBefore = endMs - 2 * 60 * 60 * 1000;
  assert.equal(lockState.closeCountsAsReturn(twoHoursBefore, endMs, endMs - 86400000), true);
  assert.equal(lockState.closeCountsAsReturn(twoHoursBefore - 1, endMs, endMs - 86400000), false);
});

test("bridgeReturnPending helpers read and detect", () => {
  const pending = bridge.getBridgeReturnPending({
    bridgeReturnPending: {
      unlockedAt: "2026-11-11T04:00:00.000Z",
      requestedAt: "2026-11-11T04:00:01.000Z",
      lastAttemptAt: null,
      attempts: 1,
    },
  });
  assert.equal(pending?.unlockedAt, "2026-11-11T04:00:00.000Z");
  assert.equal(
    bridge.bookingHasBridgeReturnPending({
      returned_at: null,
      addons: { bridgeReturnPending: pending },
    }),
    true,
  );
  assert.equal(
    bridge.bookingHasBridgeReturnPending({
      returned_at: "2026-11-11T05:00:00.000Z",
      addons: { bridgeReturnPending: pending },
    }),
    false,
  );
});

test("MANUAL_UNLOCK_KEY constant is remote-unlock", () => {
  assert.equal(lockState.MANUAL_UNLOCK_KEY, "remote-unlock");
});
