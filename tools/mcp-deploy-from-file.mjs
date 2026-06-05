import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node mcp-deploy-from-file.mjs <payload.json>');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(path, 'utf8'));
process.stdout.write(JSON.stringify({
  project_id: payload.project_id,
  name: payload.name,
  entrypoint_path: payload.entrypoint_path,
  verify_jwt: payload.verify_jwt,
  files: payload.files,
}));
