// Antigravity Voice AI - Frontend Application Logic

const orbContainer = document.getElementById('orb-container');
const voiceOrb = document.getElementById('voice-orb');
const orbStatusText = document.getElementById('orb-status-text');
const orbSubtext = document.getElementById('orb-subtext');
const liveTranscript = document.getElementById('live-transcript');
const toggleBtn = document.getElementById('toggle-btn');
const clearBtn = document.getElementById('clear-btn');
const voiceSelect = document.getElementById('voice-select');
const historyList = document.getElementById('history-list');

let isListening = false;
let isSpeaking = false;
let isThinking = false;
let isContinuousLoop = false;
let recognition = null;
let synth = window.speechSynthesis;
let availableVoices = [];
let conversationHistory = [];

// Initialize Speech Recognition API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  setOrbState('idle', 'Browser Speech Not Supported', 'Please use Google Chrome or Microsoft Edge');
} else {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

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
      setTimeout(() => {
        if (isContinuousLoop && !isListening && !isThinking && !isSpeaking) {
          try { recognition.start(); } catch (e) {}
        }
      }, 350);
    } else if (!isThinking && !isSpeaking) {
      setOrbState('idle', 'Ready', 'Click the orb to start speaking');
    }
  };
}

// Populate voices for TTS
function populateVoices() {
  if (!synth) return;
  availableVoices = synth.getVoices();
  voiceSelect.innerHTML = '<option value="">Default Natural Voice</option>';

  const englishVoices = availableVoices.filter(v => v.lang.includes('en'));
  englishVoices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  });
}

if (synth && synth.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = populateVoices;
}
populateVoices();

// UI Orb State Controller
function setOrbState(state, statusText, subtext) {
  orbContainer.className = 'orb-container';
  if (state !== 'idle') {
    orbContainer.classList.add(state);
  }

  orbStatusText.textContent = statusText;
  if (subtext) orbSubtext.textContent = subtext;

  if (toggleBtn) {
    if (state === 'listening') {
      toggleBtn.innerHTML = '<span>Stop Listening</span>';
    } else {
      toggleBtn.innerHTML = '<span>Start Conversation</span>';
    }
  }
}

// Handle User Utterance -> Send to Server -> Speak Response
async function handleUserUtterance(userText) {
  if (!userText) return;

  const cleanText = userText.toLowerCase().replace(/[^a-z]/g, '');
  if (['exit', 'quit', 'stop', 'goodbye'].includes(cleanText)) {
    isContinuousLoop = false;
    addMessageToFeed('user', userText);
    const farewell = "Goodbye! Have a great day.";
    addMessageToFeed('ai', farewell);
    speakAIResponse(farewell);
    return;
  }

  addMessageToFeed('user', userText);
  isThinking = true;
  setOrbState('thinking', 'Groq is Thinking...', 'Low-latency reasoning');

  try {
    const startTime = performance.now();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        history: conversationHistory
      })
    });

    const data = await response.json();
    const latencyMs = Math.round(performance.now() - startTime);

    isThinking = false;

    if (data.status === 'success' && data.reply) {
      conversationHistory.push({ role: 'user', content: userText });
      conversationHistory.push({ role: 'assistant', content: data.reply });

      liveTranscript.classList.remove('placeholder');
      liveTranscript.textContent = data.reply;
      addMessageToFeed('ai', `${data.reply} (⚡ ${latencyMs}ms)`);
      speakAIResponse(data.reply);
    } else {
      setOrbState('idle', 'Error communicating with Groq', data.message || 'Unknown error');
    }
  } catch (err) {
    isThinking = false;
    setOrbState('idle', 'Server Error', 'Ensure server.py is running');
    console.error('Fetch error:', err);
  }
}

// Speak response using browser native TTS
function speakAIResponse(text) {
  if (!synth) {
    setOrbState('idle', 'Ready', 'Click the orb to start speaking');
    return;
  }

  synth.cancel(); // Stop any ongoing speech
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05; // Slightly faster natural tempo

  // Prioritize default natural English voice automatically
  const naturalVoice = availableVoices.find(v => v.lang.includes('en') && (v.name.includes('Natural') || v.default)) || availableVoices.find(v => v.lang.includes('en'));
  if (naturalVoice) utterance.voice = naturalVoice;

  utterance.onstart = () => {
    isSpeaking = true;
    setOrbState('speaking', 'Antigravity Voice', text);
  };

  utterance.onend = () => {
    isSpeaking = false;
    if (isContinuousLoop) {
      setTimeout(() => {
        if (isContinuousLoop && !isListening && recognition) {
          try {
            recognition.start();
          } catch (e) {}
        }
      }, 350);
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

// Add message bubble to chat feed (safe no-op if history UI is hidden)
function addMessageToFeed(sender, text) {
  if (!historyList) return;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${sender}`;

  const senderSpan = document.createElement('span');
  senderSpan.className = 'message-sender';
  senderSpan.textContent = sender === 'user' ? 'You' : 'Antigravity Voice';

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  bubble.appendChild(senderSpan);
  bubble.appendChild(textSpan);
  historyList.appendChild(bubble);
  historyList.scrollTop = historyList.scrollHeight;
}

// Event Listeners
function toggleListening() {
  if (!recognition) return;

  if (isListening || isContinuousLoop) {
    isContinuousLoop = false;
    if (isListening) recognition.stop();
    if (isSpeaking) synth.cancel();
    setOrbState('idle', 'Ready', 'Click the orb to start speaking');
  } else {
    isContinuousLoop = true;
    if (isSpeaking) synth.cancel();
    const greeting = "Hello! How may I assist you today?";
    liveTranscript.classList.remove('placeholder');
    liveTranscript.textContent = greeting;
    speakAIResponse(greeting);
  }
}

voiceOrb.addEventListener('click', toggleListening);
voiceOrb.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') toggleListening();
});
toggleBtn.addEventListener('click', toggleListening);

clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  historyList.innerHTML = '';
  liveTranscript.textContent = 'History cleared. Speak whenever you are ready.';
  liveTranscript.classList.add('placeholder');
});
