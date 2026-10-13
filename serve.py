#!/usr/bin/env python3
"""Launch Multiwin locally using only the Python 3 standard library."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser


INDEX = Path(__file__).resolve().with_name("index.html")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_index()

    def do_HEAD(self):
        self.serve_index(head_only=True)

    def serve_index(self, head_only=False):
        # Serve only the app, never the working directory or repository metadata.
        if urlsplit(self.path).path not in ("/", "/index.html"):
            self.send_error(404)
            return
        try:
            content = INDEX.read_bytes()
        except OSError:
            self.send_error(500, "Cannot read index.html")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000,
                        help="local port (default: 8000; use 0 for a free port)")
    parser.add_argument("--no-browser", action="store_true",
                        help="print the URL without opening a browser")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        parser.exit(1, f"Cannot start Multiwin: {error}. Try --port 0 for a free port.\n")

    with server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Multiwin: {url}\nKeep this terminal open. Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            try:
                webbrowser.open(url)
            except webbrowser.Error:
                pass  # The printed address also works when no browser is configured.
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nMultiwin stopped.")


if __name__ == "__main__":
    main()
