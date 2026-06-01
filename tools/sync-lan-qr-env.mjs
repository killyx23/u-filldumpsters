import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const frontendEnvPath = path.join(projectRoot, ".env.local");
const supabaseEnvPath = path.join(projectRoot, "supabase", ".env");
const functionsEnvPath = path.join(projectRoot, "supabase", "functions", ".env");

function parseArgs(argv) {
  const args = { host: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--host") {
      args.host = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return args;
}

function normalizeLanHost(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  const withoutProtocol = value.replace(/^https?:\/\//i, "");
  const withoutPath = withoutProtocol.split("/")[0] || "";
  const withoutPort = withoutPath.split(":")[0] || "";
  return withoutPort.trim();
}

function upsertEnvValues(filePath, updates) {
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
    if (key in updates) {
      used.add(key);
      nextLines.push(`${key}=${updates[key]}`);
      continue;
    }
    nextLines.push(line);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!used.has(key)) nextLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}

function appendAllowedOrigin(filePath, origin) {
  const exists = fs.existsSync(filePath);
  const lines = exists ? fs.readFileSync(filePath, "utf8").split("\n") : [];
  let found = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIndex = line.indexOf("=");
    if (eqIndex < 1) return line;

    const key = line.slice(0, eqIndex).trim();
    if (key !== "ALLOWED_ORIGINS") return line;

    found = true;
    const rawValue = line.slice(eqIndex + 1).trim();
    const current = rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!current.includes(origin)) current.push(origin);
    return `ALLOWED_ORIGINS=${current.join(",")}`;
  });

  if (!found) {
    nextLines.push(`ALLOWED_ORIGINS=${origin}`);
  }

  fs.writeFileSync(filePath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}

function run() {
  const { host } = parseArgs(process.argv.slice(2));
  const lanHost = normalizeLanHost(host);
  if (!lanHost) {
    console.error(
      "[sync-lan-qr-env] Missing --host. Example: npm run lan:sync -- --host 192.168.1.42",
    );
    process.exit(1);
  }

  const lanOrigin = `http://${lanHost}:3000`;
  upsertEnvValues(frontendEnvPath, {
    VITE_QR_BASE_URL: lanOrigin,
  });

  appendAllowedOrigin(supabaseEnvPath, lanOrigin);
  appendAllowedOrigin(functionsEnvPath, lanOrigin);

  console.log("[sync-lan-qr-env] Updated LAN settings:");
  console.log(`- ${frontendEnvPath}`);
  console.log("    VITE_QR_BASE_URL");
  console.log(`- ${supabaseEnvPath}`);
  console.log("    ALLOWED_ORIGINS (+LAN URL)");
  console.log(`- ${functionsEnvPath}`);
  console.log("    ALLOWED_ORIGINS (+LAN URL)");
  console.log("");
  console.log("Windows PowerShell (Admin) one-time port forward:");
  console.log('$wslIp = (wsl hostname -I).Trim().Split(" ")[0]');
  console.log(
    "netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIp",
  );
  console.log(
    'New-NetFirewallRule -DisplayName "WSL Vite 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow',
  );
}

run();
