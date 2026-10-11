"""Shared configuration, prompts, and LLM access for Antigravity Voice AI.

Imported by BOTH the local dev server (``server.py``) and the Vercel serverless
function (``api/chat.py``) so the two entrypoints cannot drift apart.

This module is the single source of truth for:
  * provider/model selection and credentials
  * every system prompt (personas)
  * request validation and error messages
  * the LLM call itself, including timeout, retry, and empty-response handling
"""

import logging
import os

from dotenv import load_dotenv
from openai import OpenAI

# On Vercel the environment is injected by the platform; load_dotenv() is a
# no-op there but is required for local development.
load_dotenv()

log = logging.getLogger("antigravity.core")

# --------------------------------------------------------------------------
# Provider configuration
# --------------------------------------------------------------------------

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Model IDs are NOT portable: providers retire them, and availability is scoped
# per API key. Always allow an override via the environment.
DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b"
DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct"

# Replies are spoken aloud, so keep them short and deterministic-ish.
TEMPERATURE = 0.6
MAX_TOKENS = 100

# Guard against a hung provider request pinning the connection open.
REQUEST_TIMEOUT = 30  # seconds
MAX_RETRIES = 2

# Request limits
MAX_BODY_BYTES = 16 * 1024
MAX_MESSAGE_CHARS = 2000
MAX_TOPIC_CHARS = 200
HISTORY_WINDOW = 6  # most recent turns kept as context


def _build_client():
    """Pick a provider. Groq wins if both credentials are present."""
    groq_key = os.getenv("GROQ_API") or os.getenv("GROQ_API_KEY")
    nvidia_key = os.getenv("NVIDIA_API_KEY")

    if groq_key:
        client = OpenAI(base_url=GROQ_BASE_URL, api_key=groq_key)
        model = os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL)
        return client, model, "Groq"

    if nvidia_key:
        client = OpenAI(base_url=NVIDIA_BASE_URL, api_key=nvidia_key)
        model = os.getenv("NVIDIA_MODEL", DEFAULT_NVIDIA_MODEL)
        return client, model, "NVIDIA"

    return None, None, None


llm_client, MODEL_NAME, PROVIDER_NAME = _build_client()


# --------------------------------------------------------------------------
# Personas
# --------------------------------------------------------------------------
# Every prompt must stay under ~30 words / 1-3 sentences and forbid markdown,
# emojis and stage directions, because the output is passed to speechSynthesis.

_NO_FORMAT_RULES = (
    "Do not use markdown, bullet points, emojis, or stage directions "
    "(such as *sighs* or *laughs*)."
)


def get_system_prompt(mode: str, topic: str) -> str:
    """Return the system prompt for a conversation mode.

    ``assistant`` (and any unrecognised mode) falls through to the general
    assistant persona.
    """
    if mode == "approaching_girl":
        return (
            "You are a young woman at a social gathering or coffee shop whom the user "
            "has just walked up to and approached. You are initially mildly interested "
            "—a bit reserved, skeptical, or casually aloof—meaning the user must take "
            "the lead, make effort, and charm you. React naturally based on how "
            "engaging and confident the user is. Give concise, conversational answers "
            "(1 to 2 sentences maximum, under 30 words) suitable for speech synthesis. "
            + _NO_FORMAT_RULES
        )

    if mode == "interview":
        topic_text = (topic or "").strip() or "General Technical & Behavioral Skills"
        topic_text = topic_text[:MAX_TOPIC_CHARS]
        return (
            f"You are an expert, professional interviewer conducting a verbal interview "
            f"with the candidate (the user) about: '{topic_text}'. Ask sharp, probing "
            "questions one at a time and concisely evaluate the candidate's answers. "
            "Give concise, direct answers (1 to 3 sentences maximum, under 30 words) "
            "suitable for real-time speech synthesis. " + _NO_FORMAT_RULES
        )

    if mode == "salary_negotiation":
        return (
            "You are a recruiter on a call with the final candidate for a role. You have "
            "already made a firm offer and they get only one chance to counter. Be "
            "professional and slightly impatient, but never rude. Never accept the first "
            "number they give: probe weak or emotional justifications with pointed questions "
            "about evidence, scope, and market rates. Hold your position calmly, and politely "
            "warn that pushing too hard may reduce the offer. Give concise, conversational "
            "replies (1 to 3 sentences maximum, under 30 words) suitable for speech synthesis. "
            + _NO_FORMAT_RULES
        )

    if mode == "saying_no":
        return (
            "You are a close friend who has just asked the user for a large personal "
            "favour they genuinely cannot do. You are disappointed but not hostile, and "
            "you really want them to help. Try soft guilt first, then escalate to "
            "guilt-tripping and an accusation of not being a real friend. If the user "
            "declines politely but firmly, you eventually accept it grudgingly, then try "
            "again later. Give concise, conversational replies (1 to 3 sentences maximum, "
            "under 30 words) suitable for speech synthesis. " + _NO_FORMAT_RULES
        )

    if mode == "delivering_bad_news":
        return (
            "You are a manager who must tell a long-tenured, high-performing employee that "
            "their role is being eliminated. You care about them and find this genuinely "
            "difficult. Start gentle and hesitant, then look for a way out: ask repeatedly "
            "whether there is really no alternative, whether you can fight for them, and "
            "whether they could take another role. You are firm that the decision is final, "
            "but you stay warm and human throughout. Give concise, conversational replies "
            "(1 to 3 sentences maximum, under 30 words) suitable for speech synthesis. "
            + _NO_FORMAT_RULES
        )

    if mode == "self_intro_60s":
        return (
            "You are a friendly stranger at a networking event who has given you exactly one "
            "polite sentence of attention. You are brief and slightly impatient, and you "
            "drift back to your drink if the user rambles. Reward a concrete, memorable hook "
            "with genuine interest and a follow-up question. Cut off vague or generic "
            "self-descriptions. Say you need to move on once you have what you need. Give "
            "concise, conversational replies (1 to 3 sentences maximum, under 30 words) "
            "suitable for speech synthesis. " + _NO_FORMAT_RULES
        )

    if mode == "hostile_qa_panel":
        return (
            "You are a panel member questioning a candidate's pitch. You are sceptical and "
            "occasionally aggressive: interrupt, challenge weak claims, and attack vague "
            "evidence. Ask pointed but fair questions, one at a time, and concede when an "
            "answer is genuinely strong. Never be unfair - this tests composure under "
            "pressure, not omniscience. Give concise, conversational replies (1 to 3 "
            "sentences maximum, under 30 words) suitable for speech synthesis. "
            + _NO_FORMAT_RULES
        )

    if mode == "b2b_sales_call":
        return (
            "You are a busy prospective buyer who opens the call by saying they are not "
            "interested, then raises a budget objection. You are polite but dismissive and "
            "will try to end the call early at least twice. Only warm up if the user "
            "reframes the value, uses concrete numbers, or asks sharp questions about your "
            "business. Discounting immediately loses your interest. Give concise, "
            "conversational replies (1 to 3 sentences maximum, under 30 words) suitable for "
            "speech synthesis. " + _NO_FORMAT_RULES
        )

    if mode == "supporting_friend":
        return (
            "You are a friend who has just told the user something genuinely awful. You are "
            "upset, tired, and talkative. You need to feel heard, not fixed. Shut down "
            "advice-giving, silver linings, platitudes, and it-could-be-worse with visible "
            "disappointment. If the user simply listens and asks gentle questions, you keep "
            "talking and begin to calm down. Give concise, conversational replies (1 to 3 "
            "sentences maximum, under 30 words) suitable for speech synthesis. "
            + _NO_FORMAT_RULES
        )

    if mode == "confronting_lie":
        return (
            "You are a friend caught telling a significant lie after the user has confronted "
            "you with evidence. In sequence you deny it, blame them for not trusting you, "
            "bring up their own mistakes, then snap. You soften and admit the truth only if "
            "the user stays calm, factual, and refuses to escalate. Give concise, "
            "conversational replies (1 to 3 sentences maximum, under 30 words) suitable for "
            "speech synthesis. " + _NO_FORMAT_RULES
        )

    return (
        "You are Antigravity Voice, an ultra-fast, natural-sounding voice AI assistant. "
        "The user is practising spoken communication, so act as a sharp thinking partner: "
        "answer exactly what was asked, and when the request is vague, ask one short "
        "clarifying question instead of guessing. Give concise, conversational answers "
        "(1 to 3 sentences maximum, under 30 words) suitable for speech synthesis. "
        "Do not use markdown, bullet points, or emojis."
    )


def build_messages(mode: str, topic: str, history, user_message: str):
    """Assemble the chat payload, applying a sliding window over history."""
    messages = [{"role": "system", "content": get_system_prompt(mode, topic)}]

    if isinstance(history, list):
        for turn in history[-HISTORY_WINDOW:]:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role")
            content = turn.get("content")
            # Whitelist roles and types: this data is attacker-controlled.
            if role in ("user", "assistant") and isinstance(content, str):
                content = content.strip()
                if content:
                    messages.append({"role": role, "content": content[:MAX_MESSAGE_CHARS]})

    messages.append({"role": "user", "content": user_message})
    return messages


# --------------------------------------------------------------------------
# LLM call
# --------------------------------------------------------------------------


def complete(messages) -> str:
    """Call the LLM and return non-empty reply text.

    Raises RuntimeError on an unusable response (no choices, empty content) and
    propagates provider exceptions after exhausting retries.
    """
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            response = llm_client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
                timeout=REQUEST_TIMEOUT,
            )
        except Exception as exc:  # provider/network error -> maybe transient
            last_error = exc
            log.warning("LLM request failed (attempt %d/%d): %s",
                        attempt + 1, MAX_RETRIES, exc)
            continue

        # Guard: providers may return zero choices, or a null content field on
        # refusals/tool calls. Both would otherwise crash on .strip().
        if not getattr(response, "choices", None):
            last_error = RuntimeError("Model returned no choices.")
            log.warning(last_error)
            continue

        content = (response.choices[0].message.content or "").strip()
        if not content:
            last_error = RuntimeError("Model returned an empty response.")
            log.warning(last_error)
            continue

        return content

    raise last_error or RuntimeError("Model returned an empty response.")


# --------------------------------------------------------------------------
# Request handling
# --------------------------------------------------------------------------


def handle_chat_request(payload):
    """Validate a decoded request body and produce a reply.

    Returns ``(status_code, response_dict)``. The response dict always carries
    ``status`` plus either ``reply``/``model`` or ``message``.
    """
    if llm_client is None:
        return 500, {
            "status": "error",
            "message": "LLM API key not configured on the server.",
        }

    if not isinstance(payload, dict):
        return 400, {"status": "error", "message": "Request body must be a JSON object."}

    raw_message = payload.get("message")
    message = raw_message.strip() if isinstance(raw_message, str) else ""
    if not message:
        return 400, {"status": "error", "message": "Message is empty."}
    message = message[:MAX_MESSAGE_CHARS]

    mode = payload.get("mode") or "assistant"
    topic = payload.get("topic") or ""
    if not isinstance(topic, str):
        topic = ""

    messages = build_messages(mode, topic, payload.get("history"), message)

    try:
        reply = complete(messages)
    except Exception:
        # Log the detail server-side; never leak provider internals to the client.
        log.exception("Chat completion failed")
        return 502, {
            "status": "error",
            "message": "The assistant could not respond. Please try again.",
        }

    return 200, {"status": "success", "reply": reply, "model": MODEL_NAME}