# -*- coding: utf-8 -*-
import re
from pathlib import Path

text = Path("js/room.js").read_text(encoding="utf-8")
keys = sorted(set(re.findall(r't\("([^"]+)"', text)))
ui = Path("js/ui-i18n.js").read_text(encoding="utf-8")
missing = []
for k in keys:
    n = ui.count(f'"{k}":')
    if n < 3:
        missing.append((k, n))
print("keys used:", len(keys))
for k, n in missing:
    print(f"MISSING {k} count={n}")
if not missing:
    print("all keys present x3")

# remaining Korean user-facing strings in room.js
kr = re.findall(r'["\'`][^"\'`]*[가-힣][^"\'`]*["\'`]', text)
print("korean literals:", len(kr))
for s in kr:
    print(" ", s[:100])
