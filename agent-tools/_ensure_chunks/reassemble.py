
from pathlib import Path
parts=sorted(Path('.').glob('part_*.txt'))
content=''.join(p.read_text() for p in parts)
print(len(content))
assert len(content)==48262
