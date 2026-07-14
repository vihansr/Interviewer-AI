import os
import json
from http.server import SimpleHTTPRequestHandler, HTTPServer
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables from .env
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")

if GROQ_API_KEY:
    llm_client = OpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=GROQ_API_KEY
    )
    MODEL_NAME = "llama-3.1-8b-instant"
    print(f"[Server initialized with Groq API: {MODEL_NAME}]")
elif NVIDIA_API_KEY:
    llm_client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=NVIDIA_API_KEY
    )
    MODEL_NAME = "meta/llama-3.3-70b-instruct"
    print(f"[Server initialized with NVIDIA API: {MODEL_NAME}]")
else:
    print("Warning: GROQ_API not found in .env.")
    llm_client = None

SYSTEM_PROMPT = {
    "role": "system",
    "content": (
        "You are Antigravity Voice, a super fast, intelligent, and natural voice AI assistant. "
        "Your answers MUST be extremely concise and conversational (under 30 words) "
        "because the user is listening to you speak aloud. Speak naturally, warmly, and directly."
    )
}

class VoiceAIHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/chat":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode("utf-8"))
                user_message = data.get("message", "").strip()
                history = data.get("history", [])
                
                if not user_message:
                    self.send_error_json(400, "Message is empty.")
                    return
                
                # Construct conversation messages with sliding window (token minimization)
                messages = [SYSTEM_PROMPT]
                
                # Keep only the last 4 previous turns (8 messages max) to minimize token consumption
                recent_history = history[-6:] if len(history) > 6 else history
                messages.extend(recent_history)
                messages.append({"role": "user", "content": user_message})
                
                if not llm_client:
                    self.send_error_json(500, "GROQ_API key not configured on server.")
                    return
                
                completion = llm_client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=80,
                )
                
                reply = completion.choices[0].message.content.strip()
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                
                response_data = {
                    "status": "success",
                    "reply": reply,
                    "model": MODEL_NAME
                }
                self.wfile.write(json.dumps(response_data).encode("utf-8"))
            except Exception as e:
                print(f"[API Error: {e}]")
                self.send_error_json(500, str(e))
        else:
            self.send_error(404, "Endpoint not found")

    def send_error_json(self, status_code: int, message: str):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        response_data = {"status": "error", "message": message}
        self.wfile.write(json.dumps(response_data).encode("utf-8"))

def run_server(port=8000):
    server_address = ("", port)
    httpd = HTTPServer(server_address, VoiceAIHandler)
    print("=" * 60)
    print(f"  Antigravity Voice AI Web Server running!")
    print(f"  Open your browser at: http://localhost:{port}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
