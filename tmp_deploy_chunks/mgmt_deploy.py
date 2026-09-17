#!/usr/bin/env python3
import json, os, sys, urllib.request, mimetypes
args=json.load(open("/tmp/fn_deploy/mcp_args_end-unfinished-checkout.json"))
token=os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPABASE_TOKEN")
if not token:
  print("NO_TOKEN", file=sys.stderr); sys.exit(2)
# Use Management API: POST /v1/projects/{ref}/functions/deploy
# Multipart form per supabase docs
import uuid
boundary="----CursorDeploy"+uuid.uuid4().hex
project=args["project_id"]
name=args["name"]
meta={"name":name,"entrypoint_path":args["entrypoint_path"],"verify_jwt":args["verify_jwt"]}
body=[]
def add(name, filename, content, ctype):
  body.append(f"--{boundary}\r\n".encode())
  disp=f'Content-Disposition: form-data; name="{name}"'
  if filename:
    disp+=f'; filename="{filename}"'
  body.append(f"{disp}\r\n".encode())
  body.append(f"Content-Type: {ctype}\r\n\r\n".encode())
  if isinstance(content,str): content=content.encode()
  body.append(content)
  body.append(b"\r\n")
add("metadata", None, json.dumps(meta), "application/json")
for f in args["files"]:
  add("file", f["name"], f["content"], "application/typescript")
body.append(f"--{boundary}--\r\n".encode())
data=b"".join(body)
url=f"https://api.supabase.com/v1/projects/{project}/functions/deploy?slug={name}"
req=urllib.request.Request(url, data=data, method="POST", headers={
  "Authorization": f"Bearer {token}",
  "Content-Type": f"multipart/form-data; boundary={boundary}",
})
try:
  with urllib.request.urlopen(req, timeout=120) as resp:
    print(resp.status, resp.read()[:500])
except Exception as e:
  if hasattr(e,'read'):
    print('ERR', e, e.read()[:500])
  else:
    print('ERR', e)
  sys.exit(1)
