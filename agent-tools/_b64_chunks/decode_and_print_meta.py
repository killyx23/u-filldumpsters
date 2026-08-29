
import base64, json, hashlib
from pathlib import Path
outdir=Path(__file__).parent
n=len(list(outdir.glob("b64_*.txt")))
b64="".join((outdir/f"b64_{i:02d}.txt").read_text() for i in range(n))
content=base64.b64decode(b64).decode()
args={
  "project_id":"essesdjgtmralbkglpzw",
  "name":"ensure-lock-pin-ready",
  "entrypoint_path":"index.ts",
  "verify_jwt":False,
  "files":[{"name":"index.ts","content":content}],
}
print(json.dumps({"len":len(content),"sha":hashlib.sha256(content.encode()).hexdigest(),"has_deno":"Deno.serve" in content}))
open("/home/brandbekras/Dev/u-filldumpsters/agent-tools/DECODED_ENSURE_ARGS.json","w").write(json.dumps(args,separators=(",",":")))
