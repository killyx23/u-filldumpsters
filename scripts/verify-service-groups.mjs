/**
 * Phase 3 (service groups) verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      node scripts/verify-service-groups.mjs
 *
 * Checks that services_resolved carries correct group metadata and that
 * groupServicesForDisplay (the same function Plans.jsx uses) buckets/orders it as expected.
 */
import { execSync } from "node:child_process";
import { groupServicesForDisplay } from "../src/utils/servicePlan.js";

function readLocalEnv() {
  let out;
  try {
    out = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    console.error("Could not read local Supabase env. Start the stack with `npx supabase start`.");
    if (error?.stderr) console.error(String(error.stderr));
    process.exit(1);
  }
  const env = {};
  for (const rawLine of out.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    env[line.slice(0, eq).trim()] = value;
  }
  const apiUrl = env.API_URL ?? env.SUPABASE_URL;
  const secretKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiUrl || !secretKey) {
    console.error("Missing API_URL / SECRET_KEY from `supabase status -o env`.");
    process.exit(1);
  }
  return { apiUrl, secretKey };
}

const { apiUrl, secretKey } = readLocalEnv();
const authHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}

async function main() {
  console.log("\n=== service_groups seeded ===");
  const groups = await rest("service_groups?select=slug,name,display_order&order=display_order");
  console.log(groups.map((g) => `  ${g.display_order}. ${g.slug} (${g.name})`).join("\n"));
  check(
    "four groups seeded in the expected order",
    groups.map((g) => g.slug),
    ["dumpster-rentals", "trailer-rentals", "heavy-equipment", "material-delivery"],
  );

  console.log("\n=== services_resolved group assignment ===");
  const resolved = await rest(
    "services_resolved?select=id,name,group_slug,group_display_order,show_on_homepage&order=id",
  );
  const bySlug = Object.fromEntries(resolved.map((s) => [s.id, s.group_slug]));
  check("service 1 (bin) -> dumpster-rentals", bySlug[1], "dumpster-rentals");
  check("service 2 (trailer self-pickup) -> trailer-rentals", bySlug[2], "trailer-rentals");
  check("service 3 (material delivery) -> material-delivery", bySlug[3], "material-delivery");
  check("service 4 (trailer w/ delivery) -> trailer-rentals", bySlug[4], "trailer-rentals");
  check("service 5 (excavator) -> heavy-equipment", bySlug[5], "heavy-equipment");
  if (bySlug[8] !== undefined) {
    check("service 8 (telescoping loader) -> heavy-equipment", bySlug[8], "heavy-equipment");
  }
  check("service 7 (legacy protection plan) is left ungrouped", bySlug[7] ?? null, null);

  console.log("\n=== resolved_* fallback columns ===");
  // Clear any seeded per-service interval so the group-default fallback is observable.
  await rest("services?id=eq.2", { method: "PATCH", body: JSON.stringify({ slot_interval_minutes: null }) });
  // Set a group default and confirm a service with a null column inherits it.
  const trailerGroup = groups.find((g) => g.slug === "trailer-rentals");
  await rest(`service_groups?slug=eq.trailer-rentals`, {
    method: "PATCH",
    body: JSON.stringify({ defaults: { slot_interval_minutes: 45 } }),
  });
  const afterDefault = await rest(
    "services_resolved?select=id,slot_interval_minutes,resolved_slot_interval_minutes&id=eq.2",
  );
  check("service 2 has no explicit slot_interval_minutes", afterDefault[0].slot_interval_minutes, null);
  check(
    "resolved_slot_interval_minutes falls back to the group default",
    afterDefault[0].resolved_slot_interval_minutes,
    45,
  );
  // Explicit per-service value must win over the group default.
  await rest("services?id=eq.2", { method: "PATCH", body: JSON.stringify({ slot_interval_minutes: 90 }) });
  const afterOverride = await rest(
    "services_resolved?select=id,resolved_slot_interval_minutes&id=eq.2",
  );
  check("an explicit per-service value overrides the group default", afterOverride[0].resolved_slot_interval_minutes, 90);
  // Clean up test mutations. Restore the seeded 60-minute interval for hourly trailer pickup.
  await rest("services?id=eq.2", { method: "PATCH", body: JSON.stringify({ slot_interval_minutes: 60 }) });
  await rest(`service_groups?slug=eq.trailer-rentals`, {
    method: "PATCH",
    body: JSON.stringify({ defaults: {} }),
  });

  console.log("\n=== groupServicesForDisplay (same helper Plans.jsx calls) ===");
  const homepageRows = resolved.filter((s) => s.show_on_homepage);
  const buckets = groupServicesForDisplay(homepageRows);
  console.log(buckets.map((b) => `  ${b.slug ?? "(ungrouped)"}: [${b.services.map((s) => s.id).join(", ")}]`).join("\n"));
  check(
    "homepage groups come out sorted by group display order",
    buckets.map((b) => b.slug),
    ["dumpster-rentals", "trailer-rentals", "heavy-equipment", "material-delivery"],
  );
  check("no ungrouped bucket appears when every homepage service has a group", buckets.some((b) => b.slug === "__ungrouped__"), false);

  console.log("\n=== groupServicesForDisplay handles ungrouped services gracefully ===");
  const withUngrouped = groupServicesForDisplay([
    { id: 99, group_slug: null },
    ...homepageRows,
  ]);
  const ungroupedBucket = withUngrouped.find((b) => b.slug === "__ungrouped__");
  check("ungrouped service lands in a trailing, header-less bucket", Boolean(ungroupedBucket), true);
  check("ungrouped bucket has no display name", ungroupedBucket?.name ?? null, null);
  check("ungrouped bucket sorts last", withUngrouped[withUngrouped.length - 1].slug, "__ungrouped__");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nVerification aborted:", err.message);
  process.exit(1);
});
