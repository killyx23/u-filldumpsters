
import json, os, sys, uuid, urllib.request
from pathlib import Path

slug = sys.argv[1]
data = json.loads(Path(f".deploy_payloads/{slug}.json").read_text())
token = os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPABASE_TOKEN")
if not token:
    print("NO_TOKEN", file=sys.stderr)
    sys.exit(2)

boundary = "----CursorDeploy" + uuid.uuid4().hex
project = data["project_id"]
name = data["name"]
meta = {
    "name": name,
    "entrypoint_path": data["entrypoint_path"],
    "verify_jwt": data["verify_jwt"],
}

def add(parts, field_name, filename, content, ctype):
    parts.append(f"--{boundary}\r\n".encode())
    disp = f'Content-Disposition: form-data; name="{field_name}"'
    if filename:
        disp += f'; filename="{filename}"'
    parts.append(f"{disp}\r\n".encode())
    parts.append(f"Content-Type: {ctype}\r\n\r\n".encode())
    if isinstance(content, str):
        content = content.encode()
    parts.append(content)
    parts.append(b"\r\n")

parts = []
add(parts, "metadata", None, json.dumps(meta), "application/json")
for f in data["files"]:
    add(parts, "file", f["name"], f["content"], "application/typescript")
parts.append(f"--{boundary}--\r\n".encode())
body = b"".join(parts)

url = f"https://api.supabase.com/v1/projects/{project}/functions/deploy?slug={name}"
req = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    },
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        print(resp.status, resp.read()[:800].decode("utf-8", "replace"))
except Exception as e:
    if hasattr(e, "read"):
        print("ERR", e, e.read()[:800].decode("utf-8", "replace"), file=sys.stderr)
    else:
        print("ERR", e, file=sys.stderr)
    sys.exit(1)
