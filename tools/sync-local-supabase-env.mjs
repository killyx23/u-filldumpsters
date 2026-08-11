import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const frontendEnvPath = path.join(projectRoot, ".env.local");
const supabaseEnvPath = path.join(projectRoot, "supabase", ".env");
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
  const stripeSecretKey =
    localEnv.STRIPE_SECRET_KEY?.trim() || supabaseEnv.STRIPE_SECRET_KEY?.trim();

  const functionEnvUpdates = {
    SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: secretKey,
  };
  if (stripeSecretKey) {
    functionEnvUpdates.STRIPE_SECRET_KEY = stripeSecretKey;
  }

  upsertEnvValues(functionsEnvPath, functionEnvUpdates);

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
      "[sync-local-supabase-env] STRIPE_SECRET_KEY not found in .env.local or supabase/.env — payment step will fail until you add it.",
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
}

run();
