"""Scan _upload for personal data / secrets. Prints kinds + paths only (values redacted)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "_upload"

TEXT_SUFFIX = {
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".json",
    ".html",
    ".htm",
    ".css",
    ".md",
    ".txt",
    ".toml",
    ".yml",
    ".yaml",
    ".env",
    ".example",
    ".ignore",
    ".svg",
    ".map",
}
SPECIAL_NAMES = {
    "Dockerfile",
    ".gitignore",
    ".vercelignore",
    ".railwayignore",
    ".dockerignore",
    "vercel.json",
    "railway.toml",
}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
EMAIL_ALLOW = re.compile(
    r"(example\.com|test\.com|localhost|example\.org|your@|noreply@|users\.noreply\.github\.com)",
    re.I,
)
KEYISH = re.compile(
    r"(?i)(api[_-]?key|auth[_-]?key|secret|token|password|passwd|client_secret|"
    r"session_secret|private_key)\s*[:=]\s*['\"]?([^\s'\"]{8,})"
)
KEY_ALLOW = re.compile(
    r"(?i)(xxxx|your_|changeme|placeholder|example|process\.env|os\.environ|"
    r"getenv|redacted|todo|xxx|\$\{|environ\.get|import\.meta)",
)
DEEPL = re.compile(r"DEEPL_[A-Z_]+\s*=\s*([^\s'\"#]+)")
TOKEN = re.compile(
    r"(?i)(Bearer\s+[A-Za-z0-9\-._~+/]{20,}|sk-[A-Za-z0-9]{20,}|"
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})"
)
PHONE = re.compile(
    r"(?<!\d)(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|\+82[-.\s]?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})(?!\d)"
)
ADDR = re.compile(r"(서울|부산|대구|인천|광주|대전|울산|세종).{0,20}(구|군|동|로|길).{0,30}\d")
ADMIN = re.compile(r"ADMIN_EMAILS\s*[:=]\s*['\"]?([^'\"\n]+)")
# private home paths that identify a user account
HOME_PATH = re.compile(r"(?i)(C:\\\\Users\\\\[^\\\\/]+|/Users/[^/]+|/home/[^/]+)")
HOME_ALLOW = re.compile(r"(?i)(Users\\\\(?:Public|Default|All Users)|/Users/Shared|/home/ubuntu)")


def main() -> None:
    hits: list[tuple[str, str, str]] = []
    scanned = 0
    for fp in ROOT.rglob("*"):
        if not fp.is_file():
            continue
        if fp.suffix.lower() not in TEXT_SUFFIX and fp.name not in SPECIAL_NAMES:
            continue
        try:
            data = fp.read_bytes()
        except OSError:
            continue
        if b"\x00" in data[:2048]:
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = data.decode("cp949")
            except UnicodeDecodeError:
                continue
        scanned += 1
        rel = str(fp.relative_to(ROOT)).replace("\\", "/")

        for m in EMAIL.finditer(text):
            e = m.group(0)
            if EMAIL_ALLOW.search(e):
                continue
            hits.append(("email", rel, "REDACTED"))

        for m in KEYISH.finditer(text):
            val = m.group(2)
            if KEY_ALLOW.search(val) or val.startswith("{") or val.startswith("$"):
                continue
            hits.append(("secretish", rel, m.group(1)))

        for m in DEEPL.finditer(text):
            v = m.group(1).strip()
            if "xxxx" in v.lower():
                continue
            hits.append(("deepl_key", rel, "REDACTED"))

        for _ in TOKEN.finditer(text):
            hits.append(("token", rel, "REDACTED"))

        for _ in PHONE.finditer(text):
            hits.append(("phone", rel, "REDACTED"))

        for _ in ADDR.finditer(text):
            hits.append(("address_like", rel, "REDACTED"))

        for m in ADMIN.finditer(text):
            v = m.group(1).strip()
            low = v.lower()
            if "example" in low or "getenv" in low or "environ" in low or v.startswith("os."):
                continue
            if "@" in v:
                hits.append(("admin_emails", rel, "REDACTED"))

        for m in HOME_PATH.finditer(text):
            if HOME_ALLOW.search(m.group(0)):
                continue
            hits.append(("home_path", rel, "REDACTED"))

    print(f"scanned_text_files={scanned}")
    print(f"hits={len(hits)}")
    by_kind: dict[str, list[str]] = {}
    for kind, rel, _ in hits:
        by_kind.setdefault(kind, [])
        if rel not in by_kind[kind]:
            by_kind[kind].append(rel)
    for kind, paths in sorted(by_kind.items()):
        print(f"[{kind}] {len(paths)} files")
        for p in paths[:30]:
            print(f"  {p}")
        if len(paths) > 30:
            print(f"  ... +{len(paths) - 30} more")


if __name__ == "__main__":
    main()
