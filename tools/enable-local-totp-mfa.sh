#!/usr/bin/env bash
# Force-enable local GoTrue TOTP MFA enroll/verify on the running
# supabase_auth_u-filldumpsters container (config.toml alone is not always
# applied until a full recreate, and `supabase start` while already running
# does nothing).
set -euo pipefail

NAME="${AUTH_CONTAINER:-supabase_auth_u-filldumpsters}"

if ! docker inspect "$NAME" >/dev/null 2>&1; then
  echo "Container $NAME not found. Start local Supabase first: npx supabase start"
  exit 1
fi

TMP_INSPECT="$(mktemp)"
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_INSPECT" "$TMP_ENV"' EXIT

docker inspect "$NAME" >"$TMP_INSPECT"

python3 - "$TMP_INSPECT" "$TMP_ENV" <<'PY'
import json, sys
from pathlib import Path
ins = json.loads(Path(sys.argv[1]).read_text())[0]
envs = []
for e in ins["Config"]["Env"]:
    if e.startswith("GOTRUE_MFA_TOTP_ENROLL_ENABLED="):
        envs.append("GOTRUE_MFA_TOTP_ENROLL_ENABLED=true")
    elif e.startswith("GOTRUE_MFA_TOTP_VERIFY_ENABLED="):
        envs.append("GOTRUE_MFA_TOTP_VERIFY_ENABLED=true")
    else:
        envs.append(e)
if not any(e.startswith("GOTRUE_MFA_TOTP_ENROLL_ENABLED=") for e in envs):
    envs.append("GOTRUE_MFA_TOTP_ENROLL_ENABLED=true")
if not any(e.startswith("GOTRUE_MFA_TOTP_VERIFY_ENABLED=") for e in envs):
    envs.append("GOTRUE_MFA_TOTP_VERIFY_ENABLED=true")
Path(sys.argv[2]).write_text("\n".join(envs) + "\n")
print(ins["Config"]["Image"])
print(list(ins["NetworkSettings"]["Networks"])[0])
PY

read -r IMAGE NETWORK < <(python3 - "$TMP_INSPECT" <<'PY'
import json,sys
from pathlib import Path
ins=json.loads(Path(sys.argv[1]).read_text())[0]
print(ins["Config"]["Image"])
print(list(ins["NetworkSettings"]["Networks"])[0])
PY
)

LABEL_ARGS=()
while IFS= read -r line; do
  LABEL_ARGS+=(--label "$line")
done < <(python3 - "$TMP_INSPECT" <<'PY'
import json,sys
from pathlib import Path
ins=json.loads(Path(sys.argv[1]).read_text())[0]
for k,v in (ins["Config"].get("Labels") or {}).items():
    print(f"{k}={v}")
PY
)

echo "Recreating $NAME with TOTP MFA enroll/verify enabled…"
docker stop "$NAME" >/dev/null
docker rm "$NAME" >/dev/null
docker run -d \
  --name "$NAME" \
  --network "$NETWORK" \
  --network-alias auth \
  --restart unless-stopped \
  --env-file "$TMP_ENV" \
  "${LABEL_ARGS[@]}" \
  "$IMAGE" \
  auth >/dev/null

sleep 1
docker exec "$NAME" printenv | grep MFA_TOTP | sort
echo "Done. Hard-refresh /admin-mfa — you should see a QR code."
