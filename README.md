# Antigravity Voice AI

An ultra-low latency, real-time conversational voice assistant web application. Built with browser-native Speech-to-Text (STT), Groq Llama 3.1 8B instant inference, and browser-native Text-to-Speech (TTS) for a seamless, hands-free conversational experience.

---

## Features

- **Continuous Hands-Free Conversation Loop:** Tap the Voice Orb once to activate. After speaking its response, the assistant automatically turns the microphone back on for your next turn.
- **Professional Welcome Greeting:** Greets the user aloud immediately upon activation before opening the microphone.
- **Ultra-Low Latency Architecture:** Eliminates third-party audio upload overhead by performing speech recognition and voice synthesis directly in the browser while routing reasoning through Groq's Llama 3.1 8B API.
- **Minimalist Light Pastel Interface:** Features an interactive Voice Orb with multi-layered concentric ripple animations—sonar waves while listening and soundwave vibrations while speaking.
- **Voice Stop Commands:** Say "stop", "exit", "quit", or "goodbye" at any time to gracefully end the conversation loop.

---

## Project Structure

```text
.
├── api/
│   └── chat.py          # Vercel Python Serverless Function endpoint (/api/chat)
├── app.js               # Frontend speech engine, state controller, and loop logic
├── index.html           # Minimalist canvas layout and Voice Orb markup
├── requirements.txt     # Python dependencies for Vercel deployment
├── server.py            # Local development HTTP server and Groq proxy
├── style.css            # Light pastel theme and multi-layered ripple animations
└── vercel.json          # Vercel routing configuration
```

---

## Local Development Setup

### 1. Prerequisites
- Python 3.10 or higher
- Google Chrome or Microsoft Edge (required for webkitSpeechRecognition API support)

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and add your Groq API key:

```bash
cp .env.example .env
```

Inside `.env`, set your API key:
```ini
GROQ_API=your_actual_groq_api_key_here
```

### 3. Run the Local Server
Start the Python HTTP server on port 8000:

```bash
python server.py 8000
```

Open your browser and navigate to `http://localhost:8000`. Grant microphone access when prompted.

---

## Deploying on Vercel

This repository is pre-configured for zero-config deployment on Vercel using Python Serverless Functions (`api/chat.py`).

1. Import this repository into Vercel.
2. In your Vercel Project Settings under **Environment Variables**, add:
   - **Key:** `GROQ_API`
   - **Value:** Your Groq API key
3. Deploy the project. Static assets are served from the CDN while `/api/chat` is handled serverlessly.

---

## License

MIT License
