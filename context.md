# context.md — Antigravity Voice AI

Working notes for this codebase. Read this before making changes.

---

## 1. What this is

**Antigravity Voice AI** is a browser-based, hands-free voice conversation app. The repo is
named `Interviewer-AI` on GitHub, but the product pivoted: it started as a generic voice
assistant (see `README.md`) and now ships three **role-play / practice personas** selected at
startup.

The core latency trick: **no audio ever leaves the browser.** Speech-to-text uses the native
`webkitSpeechRecognition` API and speech-out uses `speechSynthesis`. Only *text* is sent to the
LLM. That removes upload/download of audio blobs and is the entire performance story.

```
Microphone ──> webkitSpeechRecognition (browser)  ──text──> POST /api/chat ──> api/core.py ──> LLM
Speaker    <── speechSynthesis (browser)          <─text──  JSON {reply}        │
                                                                                Groq qwen/qwen3.8-27b
                                                                                (or NVIDIA; env-overridable)
```

---

## 2. File map

| File | Role |
|---|---|
| `api/core.py` | **Single source of truth for the backend.** Provider/model selection, all system prompts, request validation, the LLM call (timeout + retry + empty-response guard). |
| `api/chat.py` | Vercel serverless entrypoint. Thin: decodes the body, calls `core.handle_chat_request`, writes JSON. |
| `server.py` | Local dev server. Threaded static file server with a blocklist, plus the same `POST /api/chat`. |
| `index.html` | Two screens: full-page intro with square mode tiles, and the conversation view. |
| `app.js` | All frontend logic: STT wiring, TTS, conversation loop, state flags, `MODE_META` catalogue. No framework, no build step. |
| `style.css` | Light pastel theme, CSS custom properties in `:root`, orb/modal animations. |
| `vercel.json` | Rewrites `/api/chat` → `/api/chat.py`. |
| `requirements.txt` | Only `openai` and `python-dotenv`. |
| `modes.txt` | Untracked. Prioritised roadmap: 7 novelty scenarios plus 8 communication-skills modes, and structural ideas. Roadmap, not code. |

**Backend logic lives in exactly one place (`api/core.py`).** Both entrypoints import it, so
local and production cannot drift. If you add a prompt, a limit, or a validation rule, change it
in `core.py` only. `core.py` sits in `api/` deliberately: it is a sibling of the serverless
entrypoint, which guarantees Vercel bundles it. `server.py` puts `api/` on `sys.path` to import it.

---

## 3. The conversation loop

This is the heart of the app and the easiest thing to break. Boolean flags govern it:

- `isListening` — STT session active
- `isSpeaking` — TTS utterance active
- `isThinking` — `fetch` in flight
- `isContinuousLoop` — the "keep going" master switch
- `activeController` — `AbortController` for the in-flight `fetch`

The loop re-arms itself in two places, both with a `350ms` delay: `recognition.onend` and
`utterance.onend`. Both route through **`startRecognition()`**, which refuses to run while
`isListening`, `isThinking`, or `isSpeaking` is true and wraps `recognition.start()` in a
logging `try/catch` (Chrome throws `InvalidStateError` on a double start).

**The invariant that matters: `isSpeaking` and `isListening` must never be left `true`.**
`synth.cancel()` does not reliably fire `onend`, and `recognition.stop()` does not reliably fire
`onend` — so every stop path calls `cancelSpeech()` / resets the flag directly. If you add a new
exit path, reset them there too. If these flags get stuck `true`, the re-arm guard blocks forever
and the app silently dies until reload.

`setOrbState(state, statusText, subtext)` is the single UI state entry point. It removes only the
known classes in `ORB_STATES` — never wipe `className`, other classes may be present.

Stopping the loop **aborts the in-flight request** via `activeController`. Without that, a reply
that lands after the user pressed stop still gets spoken.

---

## 4. Modes

Mode selection lives on a **full-page introduction screen** (`#intro-screen`), not a popup.
Layout, top to bottom: a header with the language chip, a three-step "how it works" strip, a
responsive grid of square tiles, a pre-flight note (mic + browser requirement, voice-privacy
reassurance), and a **fixed session bar** pinned to the bottom of the viewport.

The session bar is the key UX element: it shows the chosen scenario's icon, title and a one-line
hook, and its CTA names the mode (`Start Salary Negotiation`). Because it is `position: fixed`,
*Start* stays reachable no matter how far the user has scrolled past 11 tiles — the previous
bottom-of-page button was unreachable on mobile. `.intro-screen` carries `padding-bottom: 12rem`
to clear it.

Tiles (`#mode-grid`, `repeat(auto-fit, minmax(190px, 1fr))`, `aspect-ratio: 1 / 1`) are real
`<button>` elements, so keyboard support is native. `aria-pressed` is the single source of truth
for selection; selecting adds `.has-selection` to the grid, which dims every unselected tile to
`opacity: 0.5` so the choice reads at a glance. Each tile also carries an `aria-label` built from
the catalogue so screen readers get the scenario context the tile only hints at visually.

Pressing *Start session* swaps to `#conversation-screen`; the badge button in the session returns
to the intro screen to switch.

Eleven modes are live. `MODE_META` in `app.js` is the catalogue (label, orb subtext, opening
greeting per mode) and drives the badge, orb copy and greeting — no per-mode if/else chains.
The badge dot colour is read from the selected tile's `--m-accent`, so the palette lives only in
`style.css`.

| Mode key | Trains |
|---|---|
| `salary_negotiation` | Negotiation, self-advocacy, not flinching |
| `saying_no` | Assertiveness without people-pleasing |
| `delivering_bad_news` | Empathy and firmness together |
| `self_intro_60s` | Concision and memorability |
| `hostile_qa_panel` | Composure, thinking on your feet |
| `b2b_sales_call` | Objection handling, persistence |
| `supporting_friend` | Listening without rushing to fix |
| `confronting_lie` | Directness when the other person escalates |
| `interview` | Answers and composure (accepts a free-text **topic**) |
| `approaching_girl` | Rapport and leading the conversation |
| `assistant` | Thinking out loud, follow-up questions |

`assistant` (and any unrecognised value) falls through to the general persona in
`core.get_system_prompt()`. All prompts must stay under ~30 words / 1–3 sentences and forbid
markdown, emojis and stage directions — the output is spoken aloud.

**Changing mode clears `conversationHistory`.** Without that, persona A's turns are sent as
context under persona B and the replies go incoherent.

`modes.txt` holds the remaining roadmap: novelty scenarios from the original pitch, plus the
ideas for tagging cards with competencies, ramping difficulty within a persona, and adding a
post-session Coach mode.

### Adding a mode (6 touchpoints)

For key `<key>`:

1. `index.html` — a `<button class="mode-card" data-mode="<key>" id="card-<key-with-dashes>">`.
   **The id must be the key with underscores replaced by dashes** — `app.js` derives every id
   from the `MODE_META` key by exactly that rule.
2. `style.css` — one line setting `--m-accent`, `--m-tint`, `--m-icon`, `--m-glow` for
   `[data-mode="<key>"]`. No state rules needed; the shared selected-state rules consume them.
3. `app.js` — add an entry to `MODE_META` (icon, label, skill, subtext, hook, greeting). Tile
   wiring, `aria-label`, badge label, orb copy, session bar and greeting all follow automatically.
4. `api/core.py` `get_system_prompt()` — an `if mode == "<key>"` branch.

All prompts live in `core.get_system_prompt()`. They must stay under ~30 words / 1–3 sentences
and forbid markdown, emojis, and stage directions — the output is spoken aloud and markdown reads
as garbage through TTS.

**Changing mode clears `conversationHistory`.** Without that, persona A's turns are sent as
context under persona B and the replies go incoherent.

### Adding a mode (6 touchpoints)

For key `<key>`:

1. `index.html` — a `.mode-card` with `data-mode="<key>"`, unique `id`, emoji, one-line description.
2. `style.css` — `.mode-card.active[data-mode="<key>"]` (border + gradient) and the matching
   `.mode-card-icon` background. Pick an unused accent from `:root`.
3. `app.js` — `card<Key>` element ref, then add `<key>: card<Key>` to the **`MODE_CARDS` map**.
   Selection, click handlers, keyboard handlers and active-class toggling all derive from that map.
4. `app.js` `updateModeUI()` — badge label and orb subtext.
5. `app.js` `toggleListening()` — the hardcoded opening greeting.
6. `api/core.py` `get_system_prompt()` — an `if mode == "<key>"` branch.

---

## 5. Request contract

`POST /api/chat` → JSON:

```jsonc
// request
{ "message": "<user speech>", "history": [{role,content}, ...], "mode": "assistant", "topic": "" }
// success
{ "status": "success", "reply": "<text to speak>", "model": "qwen/qwen3.8-27b" }
// failure
{ "status": "error", "message": "<reason>" }
```

Status codes: `400` empty message / malformed JSON / bad `Content-Length` / non-object body,
`404` unknown endpoint, `413` body over `MAX_BODY_BYTES`, `500` no API key configured,
`502` provider failure or unusable response.

Limits live in `core.py`: `MAX_BODY_BYTES` (16 KB), `MAX_MESSAGE_CHARS` (2000),
`MAX_TOPIC_CHARS` (200), `HISTORY_WINDOW` (6). The frontend mirrors `HISTORY_WINDOW` and slices
history client-side, so the payload stays bounded.

**History is client-owned.** The server keeps no state and no session. `history` is
attacker-controlled: `build_messages` whitelists roles and types and truncates before use.

---

## 6. Provider configuration

`core._build_client()` picks Groq if present, else NVIDIA:

```
GROQ_API / GROQ_API_KEY  → https://api.groq.com/openai/v1       → $GROQ_MODEL   (default qwen/qwen3.8-27b)
NVIDIA_API_KEY           → https://integrate.api.nvidia.com/v1  → $NVIDIA_MODEL (default meta/llama-3.2-11b-vision-instruct)
neither                  → llm_client = None → 500
```

**Model IDs are not portable.** Providers retire them and availability is scoped per API key, so
a model that works for one developer 404s for another. Treat them as config, never constants.
List what a key can reach:

```bash
python -c "import os;from dotenv import load_dotenv;from openai import OpenAI;load_dotenv();print([m.id for m in OpenAI(base_url='https://api.groq.com/openai/v1',api_key=os.getenv('GROQ_API')).models.list().data])"
```

Measured on this key, against the under-30-words spoken-output constraint:

| Model | Latency | Fits the prompt? |
|---|---|---|
| `qwen/qwen3.8-27b` | **120–240ms** warm | Yes — concise, no markdown, asks a clarifying question when vague |
| `openai/gpt-oss-20b` | ~1150ms | No — markdown bullets; returned an **empty reply** end-to-end |
| `openai/gpt-oss-120b` | ~620ms | No — empty reply |

`complete()` retries once, enforces a 30s timeout, and raises on zero choices or empty content
rather than returning a blank reply. Provider exception text is logged server-side and **never**
returned to the client.

---

## 7. Frontend gotchas

- **STT is Chrome/Edge only.** `webkitSpeechRecognition` is unavailable in Firefox and Safari; the
  app degrades to a "Browser Speech Not Supported" orb state. Recognition is **not** `continuous`,
  so each turn is a fresh session — this is why the re-arm logic exists. Chrome's STT runs on
  Google's servers, so "browser-native" still means a network round trip; raw mic audio never
  leaves the machine.
- **No dead UI.** An earlier version kept `display:none` controls alive purely to satisfy script
  references. That, plus the message-feed builder, hidden voice `<select>` and clear button, was
  removed. `availableVoices` is still loaded because `speakAIResponse` uses it for voice choice.
- **Voice loading races.** Chrome populates the voice list asynchronously and may never fire
  `voiceschanged`, so `refreshVoices()` runs immediately, on the event, and on two timers.
- **Voice selection is heuristic.** `approaching_girl` scans a keyword list for a female English
  voice, now scoped to the selected language first, then English, then any.
- **Overlapping turns are ignored.** `handleUserUtterance` returns early when `isThinking`, because
  recognition can finalise one utterance twice and each would otherwise cost a paid request.
- **Stop words** are matched only as a *single whole word*: `stop` matches, `stop 2` and
  `stopping the leak` do not.
- Greetings are **hardcoded strings in `app.js`**, not model-generated, so they stay fast.
- Conversation language is user-selectable (9 locales), persisted to `localStorage`, and applied
  to both `recognition.lang` and `utterance.lang`.

---

## 8. Running and deploying

```bash
python server.py          # port 8000
python server.py 8123     # explicit port, validated
```

The dev server is `ThreadingHTTPServer`, so a slow LLM call cannot stall static asset requests.
It also **blocks serving secrets**: any path segment starting with `.` or `_`, plus `.py`,
`.pyc`, `.md`, `.txt`, `requirements.txt` and `vercel.json`, returns 404. This is not optional —
the project directory contains a live `.env`, and `SimpleHTTPRequestHandler` will otherwise serve
it to anyone who can reach the port. Client disconnects are swallowed quietly instead of dumping
`ConnectionResetError` tracebacks.

Vercel: zero-config. Only `GROQ_API` is required; `GROQ_MODEL` is optional.

---

## 9. Repo state

Uncommitted at time of writing: `.env.example`, `api/chat.py`, `app.js`, `index.html`,
`server.py`, `style.css` modified; `api/core.py`, `context.md`, `modes.txt` untracked.

---

## 10. Known gaps

1. **`/api/chat` is an unauthenticated, unmetered LLM proxy.** Deliberately out of scope for the
   last cleanup pass. No rate limiting, no origin check, no auth; the key is server-side. Add rate
   limiting per IP before treating a public deployment as safe.
2. **`README.md` is stale.** It documents only the generic assistant and Groq, its project
   structure omits `api/core.py` and the mode system, and it does not mention NVIDIA, the
   language selector, or `GROQ_MODEL`.
3. **No feedback loop.** The app simulates conversations but never coaches. For a tool meant to
   improve communication skills, a post-session debrief (filler words, talk-to-listen ratio,
   question usage) is the highest-value missing feature.
4. **Mode switching while speaking** is not handled — the greeting can interrupt an in-flight
   utterance. Minor.
5. **No tests, no linter, no CI.** Nothing guards the prompt contract or the loop invariants in
   §3, which are exactly the things that regress silently.

### Testing gotcha

Verifying CSS in this headless browser is misleading for **interpolable** properties
(`border-color`, `background-color`, transforms). The animation timeline does not reliably
advance, so `getComputedStyle` returns the *start* value indefinitely — a fully-applied rule can
look like it did nothing. Non-interpolable values (`background-image`) apply correctly, which
makes the failure look selective.

To get a trustworthy reading, temporarily set `transition: none` on the element before reading
the computed style. Do not "fix" CSS that appears not to apply without checking this first.