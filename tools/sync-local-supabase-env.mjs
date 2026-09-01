import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const frontendEnvPath = path.join(projectRoot, ".env.local");
const supabaseEnvPath = path.join(projectRoot, "supabase", ".env");
const branchesEnvPath = path.join(projectRoot, "supabase", "branches", ".env");
const functionsEnvPath = path.join(projectRoot, "supabase", "functions", ".env");

/** Keys we set in .env.local — never write raw CLI names like PUBLISHABLE_KEY here. */
const FRONTEND_KEYS = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);

/** Strip quotes from `supabase status -o env` values (e.g. ANON_KEY="eyJ..."). */
function parseEnvValue(raw) {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex < 1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = parseEnvValue(line.slice(eqIndex + 1));
    values[key] = value;
  }
  return values;
}

function parseStatusEnv(output) {
  const values = {};
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex < 1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = parseEnvValue(line.slice(eqIndex + 1));
    values[key] = value;
  }
  return values;
}

function upsertEnvValues(filePath, updates, allowedKeys) {
  const exists = fs.existsSync(filePath);
  const lines = exists ? fs.readFileSync(filePath, "utf8").split("\n") : [];

  const used = new Set();
  const nextLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      nextLines.push(line);
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex < 1) {
      nextLines.push(line);
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    // Drop mistaken dashboard / CLI keys pasted into .env.local
    if (
      allowedKeys &&
      !allowedKeys.has(key) &&
      (/^(PUBLISHABLE_KEY|SECRET_KEY|ANON_KEY|SERVICE_ROLE_KEY)$/i.test(key) ||
        /^publishable|secret$/i.test(key))
    ) {
      continue;
    }
    if (key in updates) {
      used.add(key);
      nextLines.push(`${key}=${updates[key]}`);
      continue;
    }
    nextLines.push(line);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!used.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}

function sqlDollarQuote(tag, value) {
  let token = tag;
  let i = 0;
  while (String(value).includes(`$${token}$`)) {
    i += 1;
    token = `${tag}${i}`;
  }
  return `$${token}$${value}$${token}$`;
}

/**
 * pg_net crons run inside the DB container and need vault secrets:
 * - supabase_url: in-docker Kong URL (not host localhost)
 * - service_role_key: local service role JWT
 */
function seedLocalVaultCronSecrets(serviceRoleKey) {
  const kongUrl = "http://kong:8000";
  const urlLit = sqlDollarQuote("u", kongUrl);
  const keyLit = sqlDollarQuote("k", serviceRoleKey);
  const sql = `
DO $seed$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'supabase_url' LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(${urlLit}, 'supabase_url', 'Local API URL for pg_net crons');
  ELSE
    PERFORM vault.update_secret(existing_id, ${urlLit}, 'supabase_url', 'Local API URL for pg_net crons');
  END IF;

  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'service_role_key' LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(${keyLit}, 'service_role_key', 'Local service role for pg_net crons');
  ELSE
    PERFORM vault.update_secret(existing_id, ${keyLit}, 'service_role_key', 'Local service role for pg_net crons');
  END IF;
END
$seed$;
`;

  try {
    execSync("docker exec -i supabase_db_u-filldumpsters psql -U postgres -v ON_ERROR_STOP=1 -f -", {
      cwd: projectRoot,
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    console.log(
      "[sync-local-supabase-env] Seeded vault secrets supabase_url (http://kong:8000) and service_role_key for pg_net crons.",
    );
  } catch (error) {
    console.warn(
      "[sync-local-supabase-env] Could not seed vault secrets for pg_net crons. Abandoned-checkout reminder cron will fail until they exist.",
    );
    const stderr = String(error?.stderr || error?.message || "");
    const safe = stderr
      .split("\n")
      .filter((line) => !/eyJ|Bearer |service_role/i.test(line))
      .slice(0, 8)
      .join("\n");
    if (safe.trim()) console.warn(safe);
  }
}

function run() {
  let envOutput = "";
  try {
    envOutput = execSync("npx supabase status -o env", {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    console.error(
      "[sync-local-supabase-env] Failed to read local Supabase env. Start local stack first with `npx supabase start`.",
    );
    if (error?.stderr) {
      console.error(String(error.stderr));
    }
    process.exit(1);
  }

  const env = parseStatusEnv(envOutput);
  const apiUrl = env.API_URL ?? env.SUPABASE_URL;
  // Publishable (sb_publishable_...) = anon key for browser + Vite. Do NOT use SECRET_KEY in frontend.
  const publishableKey =
    env.PUBLISHABLE_KEY ?? env.ANON_KEY ?? env.SUPABASE_ANON_KEY;
  const secretKey =
    env.SECRET_KEY ?? env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiUrl || !publishableKey) {
    console.error(
      "[sync-local-supabase-env] Missing API_URL and publishable/anon key from `supabase status -o env`.",
    );
    process.exit(1);
  }

  if (!secretKey) {
    console.error(
      "[sync-local-supabase-env] Missing SECRET_KEY / SERVICE_ROLE_KEY for supabase/functions/.env.",
    );
    process.exit(1);
  }

  upsertEnvValues(
    frontendEnvPath,
    {
      VITE_SUPABASE_URL: apiUrl,
      VITE_SUPABASE_ANON_KEY: publishableKey,
    },
    FRONTEND_KEYS,
  );

  const localEnv = parseEnvFile(frontendEnvPath);
  const supabaseEnv = parseEnvFile(supabaseEnvPath);
  const branchesEnv = parseEnvFile(branchesEnvPath);
  const existingFunctionsEnv = parseEnvFile(functionsEnvPath);
  // Prefer project-root / supabase/.env, then supabase/branches/.env, then keep
  // whatever is already in supabase/functions/.env from a prior sync.
  const stripeSecretKey =
    localEnv.STRIPE_SECRET_KEY?.trim() ||
    supabaseEnv.STRIPE_SECRET_KEY?.trim() ||
    branchesEnv.STRIPE_SECRET_KEY?.trim() ||
    existingFunctionsEnv.STRIPE_SECRET_KEY?.trim();

  const functionEnvUpdates = {
    SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: secretKey,
  };
  if (stripeSecretKey) {
    functionEnvUpdates.STRIPE_SECRET_KEY = stripeSecretKey;
  }

  upsertEnvValues(functionsEnvPath, functionEnvUpdates);

  seedLocalVaultCronSecrets(secretKey);

  const functionsEnv = parseEnvFile(functionsEnvPath);
  const iglooRequired = [
    "IGLOOHOME_CLIENT_ID",
    "IGLOOHOME_CLIENT_SECRET",
    "IGLOOHOME_BRIDGE_ID",
  ];
  const hasLockId = !!(
    functionsEnv.IGLOOHOME_LOCK_ID?.trim() ||
    functionsEnv.IGLOOHOME_DEVICE_ID?.trim()
  );
  const missingIgloo = iglooRequired.filter((key) => !functionsEnv[key]?.trim());
  if (!hasLockId) missingIgloo.push("IGLOOHOME_LOCK_ID (or IGLOOHOME_DEVICE_ID)");

  console.log("[sync-local-supabase-env] Updated (local Supabase only):");
  console.log(`- ${frontendEnvPath}`);
  console.log("    VITE_SUPABASE_URL");
  console.log("    VITE_SUPABASE_ANON_KEY  <- publishable key (sb_publishable_...)");
  console.log(`- ${functionsEnvPath}`);
  console.log("    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  if (stripeSecretKey) {
    console.log("    STRIPE_SECRET_KEY");
  } else {
    console.warn(
      "[sync-local-supabase-env] STRIPE_SECRET_KEY not found in .env.local, supabase/.env, or supabase/branches/.env — payment step will fail until you add it.",
    );
  }
  if (missingIgloo.length) {
    console.warn(
      "[sync-local-supabase-env] Igloohome PIN vars missing in supabase/functions/.env: " +
        missingIgloo.join(", ") +
        ". Access codes will fail until you add them, then run: npm run dev:functions",
    );
  }
  console.log("");
  console.log("Frontend must NOT use SECRET_KEY / service role — that stays in functions .env only.");
  console.log("Serve edge functions with: npm run dev:functions");
  console.log("Vault pg_net secrets: supabase_url, service_role_key");
}

run();
