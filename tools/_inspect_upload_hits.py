from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "_upload"


def show(rel: str, rx: re.Pattern[str], limit: int = 5) -> None:
    p = ROOT / rel
    if not p.exists():
        print(rel, "MISSING")
        return
    t = p.read_text(encoding="utf-8", errors="ignore")
    print("==", rel)
    n = 0
    for m in rx.finditer(t):
        start = max(0, m.start() - 50)
        end = min(len(t), m.end() + 50)
        ctx = t[start:end].replace("\n", " ")
        ctx = re.sub(r"[A-Za-z0-9_./\\-]{16,}", "[…]", ctx)
        ctx = re.sub(r"\d{3,}", "###", ctx)
        print(" ", ctx)
        n += 1
        if n >= limit:
            break


def main() -> None:
    show(
        "KirafanTCGWeb/index.html",
        re.compile(r"(?i)(C:\\\\Users\\\\[^\\\\/]+|/Users/[^/]+|/home/[^/]+)"),
    )
    show(
        "KirafanTCGWeb/replay.html",
        re.compile(r"(서울|부산|대구|인천|광주|대전|울산|세종).{0,20}(구|군|동|로|길).{0,30}\d"),
    )
    show(
        "KirafanTCGWeb/js/ui-i18n.js",
        re.compile(r"(서울|부산|대구|인천|광주|대전|울산|세종).{0,20}(구|군|동|로|길).{0,30}\d"),
    )
    show(
        "KirafanTCGWeb/js/auth.js",
        re.compile(
            r"(?i)(api[_-]?key|auth[_-]?key|secret|token|password|passwd|client_secret|"
            r"session_secret|private_key)\s*[:=]\s*['\"]?([^\s'\"]{8,})"
        ),
    )
    show(
        "KirafanTCGWeb/tools/api_server.py",
        re.compile(
            r"(?i)(api[_-]?key|auth[_-]?key|secret|token|password|passwd|client_secret|"
            r"session_secret|private_key)\s*[:=]\s*['\"]?([^\s'\"]{8,})"
        ),
    )
    show(
        "KirafanTCGWeb/data/scripts.json",
        re.compile(
            r"(?i)(api[_-]?key|auth[_-]?key|secret|token|password|passwd|client_secret|"
            r"session_secret|private_key)\s*[:=]\s*['\"]?([^\s'\"]{8,})"
        ),
    )
    show(
        "KirafanTCGWeb/js/vendor/fengari-web.js",
        re.compile(
            r"(?<!\d)(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|\+82[-.\s]?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})(?!\d)"
        ),
    )
    show(
        "KirafanTCGWeb/data/manifest.json",
        re.compile(
            r"(?<!\d)(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|\+82[-.\s]?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})(?!\d)"
        ),
    )
    deepl = ROOT / "KirafanTCGWeb/tools/deepl.env.example"
    print("== deepl.env.example")
    print(" ", deepl.read_text(encoding="utf-8").replace("\n", " | "))


if __name__ == "__main__":
    main()
