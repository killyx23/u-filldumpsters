/**
 * Local integration tests for reconcile-lock-pins + igloohome-webhook changes.
 *
 * Prerequisites:
 *   npx supabase start
 *   npm run supabase:sync-local-env
 *   npm run dev:functions   (separate terminal)
 *
 *   npm run test:pin-reconciler
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:55421/functions/v1";
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`  ok    ${name}`);
  else {
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
    failures += 1;
  }
}

function parseStatusEnv(output) {
  const values = {};
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

async function fnPost(name, body, token) {
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}`, apikey: token }
        : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

function psql(sql) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return execSync(
    `docker exec -i supabase_db_u-filldumpsters psql -U postgres -d postgres -t -A -c ${JSON.stringify(oneLine)}`,
    { encoding: "utf8" },
  ).trim();
}

const statusEnv = parseStatusEnv(
  execSync("npx supabase status -o env", { encoding: "utf8" }),
);
const serviceKey =
  statusEnv.SECRET_KEY ?? statusEnv.SERVICE_ROLE_KEY ?? statusEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("Could not read local service role key from `supabase status -o env`.");
  process.exit(1);
}

console.log("\nreconcile-lock-pins — auth");
{
  const unauth = await fnPost("reconcile-lock-pins", { reason: "test" });
  check("returns 401 without service role", unauth.status === 401, String(unauth.status));

  const auth = await fnPost("reconcile-lock-pins", { reason: "test" }, serviceKey);
  check("returns 200 with service role", auth.status === 200, String(auth.status));
  check("response has success=true", auth.json?.success === true, JSON.stringify(auth.json)?.slice(0, 200));
  check("response includes deleted phase", auth.json?.deleted != null);
  check("response includes generated phase", auth.json?.generated != null);
  check("response includes confirmed phase", auth.json?.confirmed != null);
  check("reason echoed back", auth.json?.reason === "test");
}

console.log("\nreconcile-lock-pins — notify-only pass");
{
  const notify = await fnPost("reconcile-lock-pins", { reason: "notify" }, serviceKey);
  check("notify returns 200", notify.status === 200, String(notify.status));
  check("notify success", notify.json?.success === true, JSON.stringify(notify.json)?.slice(0, 300));
  check("notify payload present", notify.json?.notify != null, JSON.stringify(notify.json)?.slice(0, 300));
  check("notify does not run lock phases", notify.json?.deleted == null && notify.json?.generated == null);
}

console.log("\nigloohome-webhook — job complete → lock_confirmed_at");
{
  const jobId = `test-job-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orderId = psql(`SELECT id FROM bookings WHERE status = 'Confirmed' ORDER BY id DESC LIMIT 1;`);
  check("has a confirmed booking to attach a PIN", /^\d+$/.test(orderId), orderId);
  if (!/^\d+$/.test(orderId)) {
    console.log("  skip  remaining webhook pin checks (no confirmed booking)");
  } else {
  psql(`
    INSERT INTO rental_access_codes (
      order_id, customer_email, customer_phone, access_pin, pin_id,
      start_time, end_time, status, pin_type, lock_confirmed_at, lock_deleted_at
    ) VALUES (
      ${orderId}, 'test@example.com', '', '999001', '${jobId}',
      now(), now() + interval '2 days', 'active', 'bridge_proxied', NULL, NULL
    );
  `);

  const rowCount = psql(`SELECT COUNT(*) FROM rental_access_codes WHERE pin_id = '${jobId}';`);
  check("test pin row exists", rowCount === "1", rowCount);

  const before = psql(
    `SELECT COALESCE(lock_confirmed_at::text, 'null') FROM rental_access_codes WHERE pin_id = '${jobId}' LIMIT 1;`,
  );

  const payload = {
    payload: {
      event: {
        type: 3,
        data: {
          jobId,
          jobType: 4,
          jobStatus: 0,
          completed: true,
          deviceId: "test-lock",
        },
      },
    },
  };

  const webhook = await fnPost("igloohome-webhook", payload);
  check("webhook accepts job complete", webhook.status === 200, String(webhook.status));
  check("webhook handled job", webhook.json?.handled !== false, JSON.stringify(webhook.json)?.slice(0, 200));

  const after = psql(
    `SELECT COALESCE(lock_confirmed_at::text, 'null') FROM rental_access_codes WHERE pin_id = '${jobId}' LIMIT 1;`,
  );
  check("lock_confirmed_at was null before", before === "null", before);
  check("lock_confirmed_at set after webhook", after !== "null" && after !== "", after);
  }
}

console.log("\nigloohome-webhook — bridge reconnect triggers reconciler");
{
  const bridgeId = process.env.IGLOOHOME_BRIDGE_ID || "test-bridge-local";

  psql(`
    INSERT INTO lock_bridges (bridge_id, is_online, last_event_at)
    VALUES ('${bridgeId}', false, now())
    ON CONFLICT (bridge_id) DO UPDATE SET is_online = false, last_event_at = now();
  `);

  const payload = {
    payload: {
      event: {
        type: 10,
        data: {
          bridgeId,
          isOnline: true,
        },
      },
    },
  };

  const webhook = await fnPost("igloohome-webhook", payload);
  check("bridge connection webhook returns 200", webhook.status === 200, String(webhook.status));
  check("bridge marked online", webhook.json?.isOnline === true, JSON.stringify(webhook.json)?.slice(0, 200));
  check("connectivity changed", webhook.json?.changed === true);

  // Give deferred reconciler call a moment to run
  await new Promise((r) => setTimeout(r, 2500));

  const online = psql(
    `SELECT is_online::text FROM lock_bridges WHERE bridge_id = '${bridgeId}' LIMIT 1;`,
  );
  check("lock_bridges row shows online", online === "t" || online === "true", online);
}

console.log(failures === 0 ? "\nAll local integration checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
