
from pathlib import Path
import hashlib, json
parts=sorted(Path('.').glob('part_*.bin'))
raw=b''.join(p.read_bytes() for p in parts)
print(hashlib.sha256(raw).hexdigest(), len(raw))
print(json.loads(raw)['name'])
