#!/usr/bin/env python3
"""
Reliable edge-function deploy: reads exact bytes from disk and POSTs them to the
Supabase Management API. No LLM transcription of file contents.

Usage:
  export SUPABASE_ACCESS_TOKEN=sbp_xxx          # from https://supabase.com/dashboard/account/tokens
  python3 tools/deploy_edge_functions.py        # deploys the 5 remaining funcs
  python3 tools/deploy_edge_functions.py --all  # deploys every payload in .deploy_payloads/mcp_args
  python3 tools/deploy_edge_functions.py sync-lock-activity generate-daily-pins  # explicit slugs

Each payload file (.deploy_payloads/mcp_args/<slug>.json) contains:
  { project_id, name, entrypoint_path, verify_jwt, files: [{name, content}, ...] }
The files array was generated directly from supabase/functions/ source on disk.
"""
import json
import os
import sys
import uuid
import urllib.request
from pathlib import Path

PAYLOAD_DIR = Path(".deploy_payloads/mcp_args")

# The 5 functions still needing a real deploy (default set).
DEFAULT_SLUGS = [
    "sync-lock-activity",        # repair live PLACEHOLDER
    "generate-daily-pins",
    "reconcile-lock-pins",
    "send-booking-confirmation",
    "test-lock-lifecycle",
]


def load_payload(slug: str) -> dict:
    path = PAYLOAD_DIR / f"{slug}.json"
    data = json.loads(path.read_text())
    # Safety: refuse to deploy anything that still looks like a stub.
    for f in data["files"]:
        if not f.get("content"):
            raise SystemExit(f"[{slug}] empty file content: {f['name']}")
        if "PLACEHOLDER" in f["content"]:
            raise SystemExit(f"[{slug}] payload still contains PLACEHOLDER: {f['name']}")
    names = [f["name"] for f in data["files"]]
    if not any(n.endswith(data["entrypoint_path"]) or n == data["entrypoint_path"] for n in names):
        raise SystemExit(f"[{slug}] entrypoint {data['entrypoint_path']} not in files: {names}")
    return data


def deploy(slug: str, token: str) -> None:
    data = load_payload(slug)
    boundary = "----CursorDeploy" + uuid.uuid4().hex
    project = data["project_id"]
    name = data["name"]
    meta = {
        "name": name,
        "entrypoint_path": data["entrypoint_path"],
        "verify_jwt": data["verify_jwt"],
    }

    parts = []

    def add(field_name, filename, content, ctype):
        parts.append(f"--{boundary}\r\n".encode())
        disp = f'Content-Disposition: form-data; name="{field_name}"'
        if filename:
            disp += f'; filename="{filename}"'
        parts.append(f"{disp}\r\n".encode())
        parts.append(f"Content-Type: {ctype}\r\n\r\n".encode())
        parts.append(content.encode() if isinstance(content, str) else content)
        parts.append(b"\r\n")

    add("metadata", None, json.dumps(meta), "application/json")
    for f in data["files"]:
        add("file", f["name"], f["content"], "application/typescript")
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
    total = sum(len(f["content"]) for f in data["files"])
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
            print(f"OK   {slug:34} v{payload.get('version')} verify_jwt={data['verify_jwt']} "
                  f"files={len(data['files'])} bytes={total}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        print(f"FAIL {slug:34} HTTP {e.code}: {detail}", file=sys.stderr)
        raise
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {slug:34} {e}", file=sys.stderr)
        raise


def main() -> int:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPABASE_TOKEN")
    if not token:
        print("NO_TOKEN: export SUPABASE_ACCESS_TOKEN first "
              "(https://supabase.com/dashboard/account/tokens)", file=sys.stderr)
        return 2

    args = [a for a in sys.argv[1:]]
    if args == ["--all"]:
        slugs = sorted(p.stem for p in PAYLOAD_DIR.glob("*.json"))
    elif args:
        slugs = args
    else:
        slugs = DEFAULT_SLUGS

    failed = 0
    for slug in slugs:
        try:
            deploy(slug, token)
        except Exception:  # noqa: BLE001
            failed += 1
    print(f"\nDone: {len(slugs) - failed} succeeded, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
