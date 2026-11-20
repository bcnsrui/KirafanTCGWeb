import re
from pathlib import Path

text = Path(__file__).with_name("build_ja_pack.py").read_text(encoding="utf-8")
for label, pat in [
    ("term", r'\("ソニーヤ", "(.+?)"\)'),
    ("speaker", r'"소냐": "(.+?)"'),
    ("name", r'10051331: "(.+?)"'),
]:
    m = re.search(pat, text)
    print(label, repr(m.group(1)), [hex(ord(c)) for c in m.group(1)])
