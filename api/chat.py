from http.server import BaseHTTPRequestHandler
import json
import os
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables (Vercel sets these automatically from project settings)
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")

if GROQ_API_KEY:
    llm_client = OpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=GROQ_API_KEY
    )
    MODEL_NAME = "llama-3.1-8b-instant"
elif NVIDIA_API_KEY:
    llm_client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=NVIDIA_API_KEY
    )
    MODEL_NAME = "meta/llama-3.3-70b-instruct"
else:
    llm_client = None
    MODEL_NAME = None

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        if not llm_client:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "error",
                "message": "Missing API Key. Please set GROQ_API in your Vercel Project Environment Variables."
            }).encode("utf-8"))
            return

        try:
            payload = json.loads(post_data.decode("utf-8"))
            user_message = payload.get("message", "").strip()
            history = payload.get("history", [])

            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are Antigravity Voice, an ultra-fast, natural-sounding voice AI assistant. "
                        "Give concise, conversational answers (1 to 3 sentences maximum) suitable for speech synthesis. "
                        "Do not use markdown, emojis, or bullet points."
                    )
                }
            ]

            # Include recent conversation turns (sliding window of 6)
            for turn in history[-6:]:
                role = turn.get("role", "user")
                content = turn.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

            messages.append({"role": "user", "content": user_message})

            response = llm_client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                temperature=0.6,
                max_tokens=100
            )

            ai_reply = response.choices[0].message.content.strip()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "success",
                "reply": ai_reply,
                "model": MODEL_NAME
            }).encode("utf-8"))

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "error",
                "message": str(e)
            }).encode("utf-8"))
