// Antigravity Voice AI - Frontend Application Logic

const introScreen = document.getElementById('intro-screen');
const conversationScreen = document.getElementById('conversation-screen');

const orbContainer = document.getElementById('orb-container');
const voiceOrb = document.getElementById('voice-orb');
const orbStatusText = document.getElementById('orb-status-text');
const orbSubtext = document.getElementById('orb-subtext');
const liveTranscript = document.getElementById('live-transcript');

// Intro screen controls
const modeGrid = document.getElementById('mode-grid');
const interviewTopicInput = document.getElementById('interview-topic');
const topicContainer = document.getElementById('topic-container');
const launchModeBtn = document.getElementById('launch-mode-btn');
const launchLabel = document.getElementById('launch-label');
const sessionIcon = document.getElementById('session-icon');
const sessionTitle = document.getElementById('session-title');
const sessionHook = document.getElementById('session-hook');
const langSelect = document.getElementById('lang-select');
const switchModeBtn = document.getElementById('switch-mode-btn');
const currentModeLabel = document.getElementById('current-mode-label');

let isListening = false;
let isSpeaking = false;
let isThinking = false;
let isContinuousLoop = false;
let recognition = null;
const synth = window.speechSynthesis;
let availableVoices = [];
let conversationHistory = [];

// In-flight request, so it can be aborted when the user stops the loop.
let activeController = null;

// State for active mode and topic
let currentMode = 'salary_negotiation';
let currentTopic = '';
let launchedMode = 'salary_negotiation';  // mode the running session started in

// Keep these in sync with HISTORY_WINDOW in api/core.py.
const HISTORY_WINDOW = 6;
const MAX_STORED_TURNS = 20;

// Orb states that drive CSS animations. Used to remove classes precisely
// instead of wiping className.
const ORB_STATES = ['listening', 'thinking', 'speaking'];

// --------------------------------------------------------------------------
// Mode catalogue. One entry per mode; the tile, badge, orb copy and greeting
// all derive from here, so adding a mode does not add another if/else chain.
// --------------------------------------------------------------------------
const MODE_META = {
  salary_negotiation: {
    icon: '💰',
    label: 'Salary Negotiation',
    skill: 'Negotiation · Self-advocacy',
    subtext: 'One shot to counter — hold your ground',
    hook: 'A firm recruiter. You get one shot to counter, and they probe every reason you give.',
    greeting: "Thanks for making time today. We've put together an offer, but before I finalise anything — is there anything you want to discuss about the compensation?",
  },
  saying_no: {
    icon: '🚫',
    label: 'Saying No',
    skill: 'Assertiveness · Boundaries',
    subtext: 'Decline clearly, without folding',
    hook: 'A close friend needs a favour you cannot do. They will guilt-trip you until you fold.',
    greeting: "Hey, listen. I know it's last minute, but could you help me out with something? I really need a few thousand this week.",
  },
  delivering_bad_news: {
    icon: '🕯️',
    label: 'Delivering Bad News',
    skill: 'Empathy · Firmness',
    subtext: 'Empathy and firmness, together',
    hook: 'You must tell a valued teammate their role is gone. They will look for a way out.',
    greeting: "Thanks for making the time. Do you have ten minutes? There's something I really need to talk to you about.",
  },
  self_intro_60s: {
    icon: '⏱️',
    label: '60-Second Self-Intro',
    skill: 'Concision · Being memorable',
    subtext: 'One stranger, sixty seconds',
    hook: 'One stranger, sixty seconds of attention. Ramble and they turn back to their drink.',
    greeting: "Hi! Great event, isn't it? I'm Sarah — and you are...?",
  },
  hostile_qa_panel: {
    icon: '⚖️',
    label: 'Hostile Q&A Panel',
    skill: 'Composure · Quick thinking',
    subtext: 'Stay composed under direct attack',
    hook: 'A sceptical panel interrupts you and goes straight for your weakest claim.',
    greeting: "Thanks for coming. You'll have ninety seconds to pitch, then the rest of the panel will ask questions. Whenever you're ready.",
  },
  b2b_sales_call: {
    icon: '📞',
    label: 'B2B Sales Call',
    skill: 'Objections · Persistence',
    subtext: "Reframe value, don't discount",
    hook: "They open with \"we're not interested\", then blame budget. Discounting loses the deal.",
    greeting: "Hi, thanks for calling. I'll be blunt with you — we're not really interested, but go ahead.",
  },
  supporting_friend: {
    icon: '💙',
    label: 'Supporting a Friend',
    skill: 'Listening · Not fixing',
    subtext: 'Listen without rushing to fix',
    hook: 'They have just told you something awful. They need listening, not advice.',
    greeting: "I'm so glad you picked up. Honestly, I don't really know who else I could call right now.",
  },
  confronting_lie: {
    icon: '🗡️',
    label: 'Confronting a Lie',
    skill: 'Directness · Calm under pushback',
    subtext: 'Stay direct when they escalate',
    hook: 'They deny it, blame you, then get angry. Stay calm and factual to get the truth.',
    greeting: "Wait — how do you even know that? Who exactly told you that?",
  },
  interview: {
    icon: '🎯',
    label: 'Interview Practice',
    skill: 'Answers · Composure',
    subtext: 'Interview evaluator mode ready',
    hook: 'An expert interviewer asks probing questions one at a time, then evaluates your answer.',
    greeting: null,  // built at runtime from the topic
  },
  approaching_girl: {
    icon: '💃',
    label: 'Approaching a Girl',
    skill: 'Rapport · Leading the conversation',
    subtext: "Lead the conversation — she's mildly interested",
    hook: "She is reserved and barely interested. You have to lead and earn the conversation.",
    greeting: "Um, hi? Did you need something?",
  },
  assistant: {
    icon: '🧠',
    label: 'AI Assistant',
    skill: 'Thinking out loud · Follow-ups',
    subtext: 'Ask, explain, or think out loud',
    hook: 'No script, no persona. Think out loud and practise asking better follow-up questions.',
    greeting: "Hello! How may I assist you today?",
  },
};

const MODE_CARDS = Object.keys(MODE_META).reduce((map, mode) => {
  map[mode] = document.getElementById(`card-${mode.replace(/_/g, '-')}`);
  return map;
}, {});

// --------------------------------------------------------------------------
// Screen switching
// --------------------------------------------------------------------------
function showIntro() {
  if (introScreen) introScreen.hidden = false;
  if (conversationScreen) conversationScreen.hidden = true;
  updateSessionBar();
}

function startSession() {
  if (introScreen) introScreen.hidden = true;
  if (conversationScreen) conversationScreen.hidden = false;
  updateModeUI();
}

// --------------------------------------------------------------------------
// Mode selection
// --------------------------------------------------------------------------
function selectModeCard(mode) {
  if (!MODE_META[mode]) return;
  currentMode = mode;

  // aria-pressed is the single source of truth for selection; CSS keys off it.
  Object.entries(MODE_CARDS).forEach(([key, card]) => {
    card?.setAttribute('aria-pressed', String(key === mode));
  });

  if (topicContainer) topicContainer.hidden = mode !== 'interview';

  // Once something is chosen, de-emphasise the rest so the choice is obvious.
  modeGrid?.classList.add('has-selection');

  updateSessionBar();

  if (mode === 'interview') {
    setTimeout(() => { if (interviewTopicInput) interviewTopicInput.focus(); }, 80);
  }
}

// Reflect the selected mode in the sticky bar: icon, title, scenario hook and
// a CTA that names what is about to start.
function updateSessionBar() {
  const meta = MODE_META[currentMode];
  if (!meta) return;

  if (sessionIcon) sessionIcon.textContent = meta.icon;
  if (sessionTitle) sessionTitle.textContent = meta.label;
  if (sessionHook) sessionHook.textContent = meta.hook;
  if (launchLabel) launchLabel.textContent = `Start ${meta.label}`;

  // Tint the bar icon with the tile's accent, read from CSS so the palette
  // stays defined in exactly one place.
  const card = MODE_CARDS[currentMode];
  const accent = card ? window.getComputedStyle(card).getPropertyValue('--m-accent').trim() : '';
  if (sessionIcon && accent) {
    sessionIcon.style.borderColor = accent;
    sessionIcon.style.background = `color-mix(in srgb, ${accent} 12%, #f8fafc)`;
  }
}

Object.entries(MODE_CARDS).forEach(([mode, card]) => {
  // Real <button> elements, so Enter/Space handling is native.
  card?.addEventListener('click', () => selectModeCard(mode));

  // Screen readers get the scenario context, which the tile only hints at visually.
  const meta = MODE_META[mode];
  if (card && meta) {
    card.setAttribute('aria-label', `${meta.label}. ${meta.hook} Trains: ${meta.skill.replace(/ · /g, ' and ')}.`);
  }
});

function currentBadgeText() {
  const meta = MODE_META[currentMode];
  if (!meta) return '';
  if (currentMode === 'interview' && currentTopic) {
    return { label: `${meta.label} (${currentTopic})`, subtext: `${meta.subtext} (${currentTopic})` };
  }
  return { label: meta.label, subtext: meta.subtext };
}

function updateModeUI() {
  const meta = MODE_META[currentMode];
  if (!meta) return;

  const { label, subtext } = currentBadgeText();
  if (currentModeLabel) currentModeLabel.textContent = `Mode: ${label}`;
  if (orbSubtext) orbSubtext.textContent = subtext;

  // Tint the badge dot with the selected tile's accent, read from CSS so the
  // palette stays defined in one place.
  const card = MODE_CARDS[currentMode];
  if (switchModeBtn && card) {
    const accent = window.getComputedStyle(card).getPropertyValue('--m-accent').trim();
    if (accent) switchModeBtn.style.setProperty('--m-accent', accent);
  }
}

launchModeBtn?.addEventListener('click', () => {
  if (currentMode === 'interview') {
    currentTopic = interviewTopicInput ? interviewTopicInput.value.trim() : '';
    if (!currentTopic) currentTopic = 'General Technical & Behavioral Interview';
  } else {
    currentTopic = '';
  }

  // Starting a different persona with the previous persona's turns in context
  // produces incoherent replies - reset the transcript on mode change.
  if (currentMode !== launchedMode) {
    conversationHistory = [];
    launchedMode = currentMode;
  }

  startSession();
});

switchModeBtn?.addEventListener('click', showIntro);

// --------------------------------------------------------------------------
// Language
// --------------------------------------------------------------------------
const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'pt-BR', label: 'Portuguese' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ja-JP', label: 'Japanese' },
];

let currentLang = 'en-US';

function loadLanguage() {
  try {
    const saved = window.localStorage.getItem('antigravity.lang');
    if (saved && LANGUAGES.some((l) => l.code === saved)) {
      currentLang = saved;
    }
  } catch (e) {
    /* localStorage unavailable (private mode) - fall back to default */
  }
}

function saveLanguage(code) {
  currentLang = code;
  try {
    window.localStorage.setItem('antigravity.lang', code);
  } catch (e) {
    /* ignore */
  }
  if (recognition) {
    recognition.lang = currentLang;
  }
  refreshVoices();
}

function populateLanguageSelect() {
  if (!langSelect) return;
  langSelect.innerHTML = '';
  LANGUAGES.forEach(({ code, label }) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    if (code === currentLang) option.selected = true;
    langSelect.appendChild(option);
  });
}

langSelect?.addEventListener('change', () => saveLanguage(langSelect.value));

// --------------------------------------------------------------------------
// Speech recognition
// --------------------------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  setOrbState('idle', 'Browser Speech Not Supported', 'Please use Google Chrome or Microsoft Edge');
} else {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = currentLang;

  recognition.onstart = () => {
    isListening = true;
    setOrbState('listening', 'Listening to you...', 'Speak naturally now');
    liveTranscript.classList.remove('placeholder');
    liveTranscript.textContent = '...';
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimTranscript) {
      liveTranscript.textContent = interimTranscript;
    }

    if (finalTranscript) {
      liveTranscript.textContent = finalTranscript;
      handleUserUtterance(finalTranscript.trim());
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error !== 'no-speech') {
      setOrbState('idle', 'Ready', 'Click the orb to start speaking');
    }
    isListening = false;
  };

  recognition.onend = () => {
    isListening = false;
    if (isContinuousLoop && !isThinking && !isSpeaking) {
      setTimeout(() => startRecognition(), 350);
    } else if (!isThinking && !isSpeaking) {
      setOrbState('idle', 'Ready', 'Click the orb to start speaking');
    }
  };
}

// Chrome throws InvalidStateError if start() is called while the engine is
// still starting or stopping, so guard and log instead of failing silently.
function startRecognition() {
  if (!recognition || isListening || isThinking || isSpeaking) return;
  try {
    recognition.start();
  } catch (e) {
    console.warn('recognition.start() failed:', e && e.message);
  }
}

// Load voices for TTS. Chrome populates the voice list asynchronously and may
// never fire `voiceschanged`, so poll as well.
function refreshVoices() {
  availableVoices = synth ? synth.getVoices() : [];
}

if (synth) {
  refreshVoices();
  if (typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', refreshVoices);
  } else {
    synth.onvoiceschanged = refreshVoices;
  }
  setTimeout(refreshVoices, 250);
  setTimeout(refreshVoices, 1000);
}

// --------------------------------------------------------------------------
// UI state
// --------------------------------------------------------------------------
function setOrbState(state, statusText, subtext) {
  // Remove only the known animation classes rather than wiping className.
  orbContainer.classList.remove(...ORB_STATES);
  if (state !== 'idle') {
    orbContainer.classList.add(state);
  }

  orbStatusText.textContent = statusText;
  if (subtext) orbSubtext.textContent = subtext;

  updatePressedState();
}

// Stop any speech immediately. cancel() does not reliably fire the utterance's
// onend, so isSpeaking must be reset here or the loop can never restart.
function cancelSpeech() {
  if (synth) synth.cancel();
  isSpeaking = false;
}

function updatePressedState() {
  if (voiceOrb) voiceOrb.setAttribute('aria-pressed', String(isContinuousLoop));
}

const STOP_WORDS = new Set(['exit', 'quit', 'stop', 'goodbye', 'bye']);

function isStopCommand(userText) {
  // Keep digits so "stop 2" is not mistaken for the bare command "stop".
  const words = userText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.length === 1 && STOP_WORDS.has(words[0]);
}

// --------------------------------------------------------------------------
// Conversation
// --------------------------------------------------------------------------
async function handleUserUtterance(userText) {
  if (!userText) return;

  if (isStopCommand(userText)) {
    isContinuousLoop = false;
    updatePressedState();
    if (activeController) activeController.abort();
    cancelSpeech();
    const farewell = 'Goodbye! Have a great day.';
    liveTranscript.textContent = farewell;
    speakAIResponse(farewell);
    return;
  }

  // Ignore overlapping turns: recognition can finalise the same utterance twice
  // and each would otherwise trigger a paid request.
  if (isThinking) return;

  isThinking = true;
  setOrbState('thinking', 'Thinking...', 'Low-latency reasoning');

  const controller = new AbortController();
  activeController = controller;

  try {
    const startTime = performance.now();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: userText,
        // Send only the window the server will actually use.
        history: conversationHistory.slice(-HISTORY_WINDOW),
        mode: currentMode,
        topic: currentTopic
      })
    });

    const data = await response.json();
    const latencyMs = Math.round(performance.now() - startTime);

    if (data.status === 'success' && data.reply) {
      conversationHistory.push({ role: 'user', content: userText });
      conversationHistory.push({ role: 'assistant', content: data.reply });
      // Bound client-side memory; the server only ever reads the last few.
      if (conversationHistory.length > MAX_STORED_TURNS) {
        conversationHistory = conversationHistory.slice(-MAX_STORED_TURNS);
      }

      liveTranscript.classList.remove('placeholder');
      liveTranscript.textContent = data.reply;
      liveTranscript.title = `${data.reply}  ·  ${latencyMs}ms`;
      speakAIResponse(data.reply);
    } else {
      setOrbState('idle', 'Assistant error', data.message || 'Unknown error');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      // User stopped the conversation mid-request; not an error state.
      return;
    }
    setOrbState('idle', 'Server Error', 'Could not reach the assistant');
    console.error('Fetch error:', err);
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
    isThinking = false;
    updatePressedState();
  }
}

// Pick a voice matching the selected language, with sensible fallbacks.
function selectVoice() {
  if (!availableVoices.length) return null;

  const langPrefix = currentLang.split('-')[0].toLowerCase();
  const inLang = availableVoices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  const inEnglish = availableVoices.filter((v) => v.lang.toLowerCase().startsWith('en'));

  if (currentMode === 'approaching_girl') {
    // Prefer a female voice for this persona (Microsoft Zira on Windows,
    // Samantha on macOS, Google US English, ...).
    const femaleKeywords = ['zira', 'samantha', 'hazel', 'susan', 'karen', 'victoria', 'female'];
    for (const keyword of femaleKeywords) {
      const match = inLang.find((v) => v.name.toLowerCase().includes(keyword))
        || inEnglish.find((v) => v.name.toLowerCase().includes(keyword));
      if (match) return match;
    }
  }

  return (inLang.find((v) => v.default))
    || inEnglish.find((v) => v.default)
    || inLang[0]
    || inEnglish[0]
    || null;
}

function speakAIResponse(text) {
  if (!synth) {
    setOrbState('idle', 'Ready', 'Click the orb to start speaking');
    return;
  }

  cancelSpeech(); // Stop any ongoing speech

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = currentLang;
  utterance.rate = 1.05; // Slightly faster natural tempo

  const voice = selectVoice();
  if (voice) {
    utterance.voice = voice;
  }

  utterance.onstart = () => {
    isSpeaking = true;
    setOrbState('speaking', 'Antigravity Voice', text);
  };

  utterance.onend = () => {
    isSpeaking = false;
    if (isContinuousLoop) {
      setTimeout(() => startRecognition(), 350);
    } else {
      setOrbState('idle', 'Ready', 'Click the orb to speak again');
    }
  };

  utterance.onerror = () => {
    isSpeaking = false;
    setOrbState('idle', 'Ready', 'Click the orb to speak again');
  };

  synth.speak(utterance);
}

function buildGreeting() {
  const meta = MODE_META[currentMode];
  if (currentMode === 'interview') {
    const topicText = currentTopic || 'your background';
    return `Welcome. Let's get right into our interview regarding ${topicText}. To begin, could you tell me about your experience with this?`;
  }
  return (meta && meta.greeting) || MODE_META.assistant.greeting;
}

function toggleListening() {
  if (!recognition) return;

  if (isListening || isContinuousLoop) {
    isContinuousLoop = false;
    // Reset the flags ourselves: stop()/cancel() do not guarantee onend/onerror.
    isListening = false;
    isSpeaking = false;
    if (activeController) activeController.abort();
    try { recognition.stop(); } catch (e) { /* already stopped */ }
    cancelSpeech();
    setOrbState('idle', 'Ready', 'Click the orb to start speaking');
  } else {
    isContinuousLoop = true;
    cancelSpeech();

    const greeting = buildGreeting();
    liveTranscript.classList.remove('placeholder');
    liveTranscript.textContent = greeting;
    speakAIResponse(greeting);
  }
}

voiceOrb?.addEventListener('click', toggleListening);

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
loadLanguage();
populateLanguageSelect();
selectModeCard(currentMode);
updateModeUI();
showIntro();