"""Vercel serverless entrypoint for Antigravity Voice AI.

Handles POST /api/chat (routed here by vercel.json). All logic lives in
`core`, which is shared with the local development server.
"""

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

# Ensure the shared module resolves whether or not the runtime already has
# this function's directory on sys.path.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from core import MAX_BODY_BYTES, handle_chat_request  # noqa: E402

log = logging.getLogger("antigravity.api")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/api/chat", "/api/chat.py", "/"):
            self.send_json(404, {"status": "error", "message": "Endpoint not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            self.send_json(400, {"status": "error", "message": "Invalid Content-Length header."})
            return

        if content_length <= 0:
            self.send_json(400, {"status": "error", "message": "Empty request body."})
            return

        if content_length > MAX_BODY_BYTES:
            self.send_json(413, {"status": "error", "message": "Request body too large."})
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
        encoded = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        log.info("%s - %s", self.address_string(), format % args)