import re
import urllib.request

url = "https://wiki.kirafan.moe/js/app.ccb68acc.js"
t = urllib.request.urlopen(url, timeout=60).read().decode("utf-8", "replace")
print("len", len(t))
patterns = [
    r"https?://[^\"'\\]+",
    r"[\"'](/[^\"']*(?:master|cdn|api|Named|character|Asset)[^\"']*)[\"']",
    r"cdn[^\"'\\]{0,100}",
    r"Named[A-Za-z]+",
]
for pat in patterns:
    hits = re.findall(pat, t, re.I)
    uniq = []
    for h in hits:
        if h not in uniq:
            uniq.append(h)
    print("PAT", pat[:50], "count", len(uniq))
    for h in uniq[:50]:
        print(" ", h[:200])
