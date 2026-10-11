"""Local development server for Antigravity Voice AI.

Serves the static frontend and proxies /api/chat to the LLM using the shared
core module. Production uses api/chat.py (Vercel serverless) instead.
"""

import json
import logging
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Make the shared `core` module (which lives next to the serverless entrypoint)
# importable from the project root.
_API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api")
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from core import (  # noqa: E402  (import must follow the sys.path tweak)
    MAX_BODY_BYTES,
    MODEL_NAME,
    PROVIDER_NAME,
    handle_chat_request,
)

log = logging.getLogger("antigravity.server")

# Files that must never be served over HTTP. This project directory contains
# .env (live API keys), Python sources and internal notes; SimpleHTTPRequestHandler
# would happily hand all of them to any client.
BLOCKED_SUFFIXES = (".py", ".pyc", ".md", ".txt", ".env")
BLOCKED_NAMES = {"__pycache__", "requirements.txt", "vercel.json"}


def _is_blocked(path: str) -> bool:
    """Return True if a URL path must not be served as a static file."""
    clean = path.split("?", 1)[0].split("#", 1)[0]
    segments = [s for s in clean.split("/") if s]
    if not segments:
        return False

    for segment in segments:
        # Dotfiles (.env, .gitignore) and the .git directory
        if segment.startswith("."):
            return True
        # Directories Python creates alongside sources
        if segment.startswith("_"):
            return True
        if segment in BLOCKED_NAMES:
            return True
        if segment.lower().endswith(BLOCKED_SUFFIXES):
            return True

    return False


class VoiceAIHandler(SimpleHTTPRequestHandler):
    # Accurate Content-Length on every response enables keep-alive.
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if _is_blocked(self.path):
            log.info("Blocked static request for %s", self.path)
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self):
        if _is_blocked(self.path):
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404, "Endpoint not found")
            return

        # Parse and validate Content-Length before reading anything.
        try:
            content_length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            self.send_json(400, {"status": "error", "message": "Invalid Content-Length header."})
            self.close_connection = True
            return

        if content_length <= 0:
            self.send_json(400, {"status": "error", "message": "Empty request body."})
            return

        if content_length > MAX_BODY_BYTES:
            # Body was not drained, so the stream is no longer usable.
            self.send_json(413, {"status": "error", "message": "Request body too large."})
            self.close_connection = True
            return

        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.send_json(400, {"status": "error", "message": f"Malformed JSON body: {exc}"})
            return

        status_code, data = handle_chat_request(payload)
        self.send_json(status_code, data)

    def send_json(self, status_code: int, data: dict):
        """Send a JSON response with an accurate Content-Length."""
        encoded = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        # Quieter than the default stderr logging, but still informative.
        log.info("%s - %s", self.address_string(), format % args)


class DevServer(ThreadingHTTPServer):
    """Threaded so a slow LLM call cannot stall static asset requests."""

    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Drop client disconnects quietly instead of dumping a traceback."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


def run_server(port: int = 8000):
    httpd = DevServer(("", port), VoiceAIHandler)
    print("=" * 60)
    if PROVIDER_NAME:
        print(f"  Antigravity Voice AI — provider: {PROVIDER_NAME} ({MODEL_NAME})")
    else:
        print("  Antigravity Voice AI — WARNING: no LLM API key configured")
    print(f"  Open your browser at: http://localhost:{port}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down...")
    finally:
        httpd.server_close()


def _parse_port(argv) -> int:
    """Accept an optional port from the CLI, e.g. `python server.py 8080`."""
    if len(argv) < 2:
        return 8000
    try:
        port = int(argv[1])
    except ValueError:
        print(f"Invalid port: {argv[1]!r}. Usage: python server.py [port]")
        raise SystemExit(2)
    if not (1 <= port <= 65535):
        print(f"Port out of range: {port}. Usage: python server.py [port]")
        raise SystemExit(2)
    return port


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run_server(_parse_port(sys.argv))