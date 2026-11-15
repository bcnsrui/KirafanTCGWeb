"""Local static server with no-cache for HTML/JS so language-pack updates apply immediately."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

NO_CACHE_SUFFIXES = {".html", ".js", ".css", ".json", ".mjs"}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = Path(self.translate_path(self.path)).suffix.lower()
        if path in NO_CACHE_SUFFIXES or self.path.rstrip("/").endswith("sw.js"):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # keep default logging
        super().log_message(fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    handler = partial(Handler, directory=str(ROOT))
    httpd = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"KirafanWeb http://{args.bind}:{args.port}  root={ROOT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
