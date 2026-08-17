// ════════════════════════════════════════════════
// Extracted from the original monolithic interview.js during Phase 0
// architecture cleanup. Still classic global-scope scripts (no ES
// modules / bundler introduced) — order of <script> tags in
// interview.html matters and must match the order below:
//   state.js -> setup.js -> media.js -> speech.js -> conversation.js -> recording.js
// ════════════════════════════════════════════════

function loadVoices() { availableVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function pickVoice() {
  if (!availableVoices.length) loadVoices();
  const goodEnglishNames = ['Google UK English Male', 'Daniel', 'Eddy (English (United States))', 'Google US English'];
  const avoidNames = ['Bad News','Bahh','Bells','Boing','Bubbles','Cellos','Trinoids','Whisper','Wobble','Zarvox','Good News','Superstar','Jester','Organ','Albert'];

  if (selectedLanguage !== 'english') {
    const langPrefix = getLangConfig().speechLang.split('-')[0]; // e.g. 'hi', 'ta', 'bn'
    return availableVoices.find(v => v.lang.toLowerCase().startsWith(langPrefix))
      || availableVoices.find(v => goodEnglishNames.includes(v.name))
      || availableVoices[0];
  }
  for (const name of goodEnglishNames) {
    const match = availableVoices.find(v => v.name === name);
    if (match) return match;
  }
  return availableVoices.find(v => v.lang.startsWith('en') && !avoidNames.includes(v.name)) || availableVoices[0];
}

function speakAsInterviewer(text, onDoneCallback) {
  window.speechSynthesis.cancel();
  // recognition को touch नहीं करते — सिर्फ isListening flag बंद करते हैं
  isListening = false;

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = getLangConfig().speechLang;
  // Tiny per-utterance jitter — a real voice never lands on the exact same
  // rate/pitch every single time; a perfectly flat delivery is a bot tell.
  utterance.rate = 0.92 + (Math.random() * 0.1 - 0.05);   // ~0.87–0.97
  utterance.pitch = 1.0 + (Math.random() * 0.08 - 0.04);   // ~0.96–1.04

  const dot = document.getElementById('avatarDot');
  const statusText = document.getElementById('avatarStatusText');

  utterance.onstart = () => {
    dot.classList.add('speaking');
    statusText.textContent = 'Speaking...';
    // Arjun बोलने लगे → video play करो
    const avatar = document.getElementById('aiAvatarVideo');
    if (avatar) avatar.play();
  };
  utterance.onend = () => {
    dot.classList.remove('speaking');
    statusText.textContent = 'Listening...';
    // Arjun चुप हो जाए → video pause करो
    const avatar = document.getElementById('aiAvatarVideo');
    if (avatar) { avatar.pause(); avatar.currentTime = 0; }
    if (onDoneCallback) onDoneCallback();
    else autoStartListening();
  };
  utterance.onerror = (err) => {
    console.error('Speech synthesis runtime tracking failure:', err);
    const avatar = document.getElementById('aiAvatarVideo');
    if (avatar) { avatar.pause(); avatar.currentTime = 0; }
    if (onDoneCallback) onDoneCallback();
    else autoStartListening();
  };
  window.speechSynthesis.speak(utterance);
}

// ════════════════════════════════════════════════
// SPEECH TO TEXT — simple and reliable
// ════════════════════════════════════════════════
// Chrome's recognizer often returns several candidate transcripts per
// result with a confidence score each — the browser's own onresult only
// ever surfaces alternative[0], which isn't always the best guess,
// especially for quieter or slightly unclear speech. Scan all offered
// alternatives and use whichever one the engine itself scored highest.
function pickBestAlternative(result) {
  let best = result[0];
  for (let j = 1; j < result.length; j++) {
    const alt = result[j];
    // confidence is 0 when the browser doesn't report it — in that case
    // stick with alternative[0] rather than treating 0 as "worse than 0".
    if (typeof alt.confidence === 'number' && alt.confidence > (best.confidence || 0)) {
      best = alt;
    }
  }
  return best.transcript;
}

// iPadOS 13+ reports itself as "Macintosh" in the user agent (desktop-class
// Safari), so a plain iPhone/iPad UA check misses iPads — the extra
// maxTouchPoints check catches that case without misidentifying a real Mac
// (which has no touch points).
function isIOSDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn('Speech recognition not supported.');
    disableVoiceInput(
      "⚠️ This browser/device doesn't support voice recognition. Please type your answer below, or switch to Chrome/Edge on desktop or Android for voice input."
    );
    return;
  }

  recognition = new SR();
  // iOS/iPadOS (Safari, and Chrome/Edge there too — Apple forces every
  // browser onto WebKit) has a long-standing bug where continuous:true
  // either never stops listening or never fires a result at all. Non-iOS
  // browsers get real continuous mode; iOS gets short sessions that
  // restart immediately via recognition.onend below, which reads as
  // continuous to the candidate without hitting the WebKit bug.
  recognition.continuous = !isIOSDevice();
  recognition.interimResults = true;
  recognition.lang = getLangConfig().speechLang;
  recognition.maxAlternatives = 3; // let us pick the best-scoring guess, not just the engine's first pick

  recognition.onresult = (event) => {
    noteSpeechActivity(); // any result — interim or final — counts as "still talking"
    recentRecognitionErrors = []; // it's working — clear any earlier failure streak
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const t = pickBestAlternative(result);
      if (result.isFinal) {
        speechBuffer += t + ' ';
      } else {
        interimText += t;
      }
    }
    const textarea = document.getElementById('answerInput');
    if (textarea) textarea.value = speechBuffer + interimText;
    const status = document.getElementById('speechStatus');
    if (status && interimText) status.textContent = `🎙️ Hearing: "${interimText}"`;
  };

  recognition.onerror = (event) => {
    console.log('Speech error:', event.error);

    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      // Mic permission was denied or got revoked mid-interview. Retrying
      // won't fix this on its own — say so clearly instead of leaving the
      // status stuck on a stale "Listening...". Fresh chance again next question.
      disableVoiceInput(
        "⚠️ Mic access is blocked for this site. Please allow microphone permission in your browser's site settings and refresh, or type your answer below."
      );
      return;
    }

    if (event.error === 'audio-capture') {
      // No mic input device found (unplugged, OS-level conflict with
      // another app, etc). A couple of quick retries is worth it in case
      // it's momentary, but looping forever on a genuine hardware issue
      // just burns battery while the candidate sits confused.
      if (trackRecognitionFailure()) {
        disableVoiceInput(
          "⚠️ No microphone was found on this device. Please check your mic connection, or type your answer below."
        );
        return;
      }
      recognitionRunning = false;
      if (isListening && !interviewEnded) setTimeout(() => startFreshRecognition(), 400);
      return;
    }

    if (event.error === 'network') {
      // Web Speech API ships audio to the browser vendor's cloud STT
      // service — a flaky connection shows up here. Retry quickly a few
      // times (most blips clear up), but after repeated failures in a
      // short window, stop hammering it and hand off to typing instead.
      if (trackRecognitionFailure()) {
        disableVoiceInput(
          "🌐 Voice recognition is struggling with your connection — no worries, just type your answer below and we'll continue."
        );
        return;
      }
      recognitionRunning = false;
      if (isListening && !interviewEnded) setTimeout(() => startFreshRecognition(), 150);
      return;
    }

    recognitionRunning = false;
    // Other transient errors (e.g. 'aborted') — restart quickly, a long
    // gap here is exactly what causes missed words mid-sentence.
    if (isListening && !interviewEnded) {
      setTimeout(() => startFreshRecognition(), 150);
    }
  };

  recognition.onend = () => {
    recognitionRunning = false;
    // Restart immediately (no artificial delay) so a self-restart by the
    // browser (continuous sessions time out on their own) doesn't create a
    // silent gap while the candidate is still mid-sentence.
    if (isListening && !interviewEnded) {
      startFreshRecognition();
    }
  };
}

function startFreshRecognition() {
  if (!recognition || interviewEnded || !isListening) return;
  if (recognitionRunning) return; // already running — don't abort a live session, that discards audio mid-word
  try {
    recognition.start();
    recognitionRunning = true;
    lastRecognitionStartAt = Date.now();
  } catch (e) {
    // "already started" races can happen right as onend fires — retry shortly instead of losing the turn
    if (e && e.name === 'InvalidStateError') {
      setTimeout(() => startFreshRecognition(), 150);
    } else {
      console.log('Recognition start error:', e.message);
    }
  }
}

// Records a network/audio-capture failure and reports back whether we've
// now seen too many of them in too short a window to keep calling it a
// "blip". Returns true = stop retrying for this turn, false = worth one
// more quick retry.
function trackRecognitionFailure() {
  const now = Date.now();
  recentRecognitionErrors = recentRecognitionErrors.filter(
    (t) => now - t < RECOGNITION_ERROR_WINDOW_MS
  );
  recentRecognitionErrors.push(now);
  return recentRecognitionErrors.length >= RECOGNITION_ERROR_LIMIT;
}

// Voice input genuinely can't work right now (unsupported browser, mic
// permission blocked, or repeated hardware/network failures). Stop
// retrying, say why in plain language, and make sure typing is obviously
// still the way forward — the candidate should never be left staring at a
// stuck "Listening..." status with no idea why nothing is happening.
// autoStartListening() gives voice a fresh chance again on the next
// question, so this is never a permanent, whole-interview kill switch.
function disableVoiceInput(message) {
  voiceInputDisabled = true;
  isListening = false;
  recognitionRunning = false;
  clearSilenceWatcher();
  stopVolumeMonitor();
  try { if (recognition) recognition.abort(); } catch (e) {}

  const status = document.getElementById('speechStatus');
  if (status) {
    status.textContent = message;
    status.className = 'speech-status error';
  }
  const btn = document.getElementById('speakBtn');
  if (btn) { btn.textContent = '⌨️ Type your answer'; btn.classList.remove('active'); }

  const textarea = document.getElementById('answerInput');
  if (textarea) textarea.focus();
}

// ════════════════════════════════════════════════
// MIC VOLUME MONITOR — nudge quiet speakers
// Web Speech API grabs the mic itself; we can't hand it a boosted
// stream. So instead we watch real input level from mediaStream and,
// if the candidate has been speaking but consistently faint for a
// few seconds, show a gentle on-screen hint to move closer / speak up.
// ════════════════════════════════════════════════
function startVolumeMonitor() {
  if (!mediaStream || audioAnalyser) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 1024;
    source.connect(audioAnalyser);

    const data = new Uint8Array(audioAnalyser.fftSize);
    lastVolumeSampleAt = Date.now();

    const tick = () => {
      audioMonitorRafId = requestAnimationFrame(tick);
      if (!audioAnalyser) return;
      audioAnalyser.getByteTimeDomainData(data);

      // RMS of the waveform (0 = silence, ~0.02+ = normal speech)
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);

      const now = Date.now();
      const elapsed = now - (lastVolumeSampleAt || now);
      lastVolumeSampleAt = now;

      if (!isListening) { lowVolumeStreakMs = 0; return; }

      if (rms > NEAR_SILENCE_RMS_FLOOR && rms < LOW_VOLUME_RMS_THRESHOLD) {
        lowVolumeStreakMs += elapsed;
      } else if (rms >= LOW_VOLUME_RMS_THRESHOLD) {
        // Speaking at a healthy volume — reset the streak and clear any nudge
        lowVolumeStreakMs = 0;
        if (lowVolumeNudgedThisTurn) {
          lowVolumeNudgedThisTurn = false;
          const status = document.getElementById('speechStatus');
          if (status && status.classList.contains('low-volume')) {
            status.textContent = '🎙️ Listening... speak now';
            status.className = 'speech-status listening';
          }
        }
      }

      if (!lowVolumeNudgedThisTurn && lowVolumeStreakMs >= LOW_VOLUME_NUDGE_AFTER_MS) {
        lowVolumeNudgedThisTurn = true;
        const status = document.getElementById('speechStatus');
        if (status) {
          status.textContent = "🔉 I'm hearing you very faintly — try moving a little closer to the mic or speaking a bit louder.";
          status.className = 'speech-status low-volume';
        }
      }
    };
    tick();
  } catch (e) {
    console.log('Volume monitor unavailable:', e.message);
  }
}

function stopVolumeMonitor() {
  if (audioMonitorRafId) { cancelAnimationFrame(audioMonitorRafId); audioMonitorRafId = null; }
  if (audioContext) { try { audioContext.close(); } catch (e) {} audioContext = null; }
  audioAnalyser = null;
  lowVolumeStreakMs = 0;
  lowVolumeNudgedThisTurn = false;
}

function armSilenceWatcher() {
  clearSilenceWatcher();
  lastSpeechActivityAt = Date.now();
  silenceWatcherId = setInterval(() => {
    if (!isListening || interviewEnded) { clearSilenceWatcher(); return; }

    // Proactively rotate the recognition session before it can hit the
    // silent-death failure mode. .stop() (not .abort()) finalizes whatever
    // was captured so far instead of discarding it — onend then restarts
    // a fresh session automatically.
    if (recognitionRunning && lastRecognitionStartAt &&
        Date.now() - lastRecognitionStartAt >= RECOGNITION_REFRESH_MS) {
      try { recognition.stop(); } catch (e) {}
    }

    // Hard fallback: if we think a session should be running but it's gone
    // quiet for way longer than a rotation should ever take, something died
    // silently without firing onend/onerror — force a clean restart.
    if (recognitionRunning && lastRecognitionStartAt &&
        Date.now() - lastRecognitionStartAt >= RECOGNITION_REFRESH_MS + RECOGNITION_STUCK_GRACE_MS) {
      recognitionRunning = false;
      try { recognition.abort(); } catch (e) {}
      startFreshRecognition();
    }

    if (Date.now() - lastSpeechActivityAt >= SILENCE_TIMEOUT_MS) {
      clearSilenceWatcher();
      handleSilenceTimeout();
    }
  }, 1000);
}

function clearSilenceWatcher() {
  if (silenceWatcherId) { clearInterval(silenceWatcherId); silenceWatcherId = null; }
}

function noteSpeechActivity() {
  lastSpeechActivityAt = Date.now();
}

// Candidate went quiet for 45s straight — Arjun nudges and moves on, like a real interviewer would
async function handleSilenceTimeout() {
  if (interviewEnded || answerInFlight) return;
  answerInFlight = true;

  stopListening();
  window.speechSynthesis.cancel();
  trackResponseTime();

  const answerInput = document.getElementById('answerInput');
  const partialAnswer = (answerInput.value || speechBuffer).trim();
  const questionText = document.getElementById('currentQuestion').textContent;

  if (partialAnswer.length > 3) {
    // They'd started answering — use what was captured instead of discarding it
    await saveQAToBackend(questionText, partialAnswer);
    conversationHistory.push({ role: 'user', content: partialAnswer });
    answerInput.value = '';
    speechBuffer = '';
    await loadNextQuestion();
    return;
  }

  await saveQAToBackend(questionText, '[No response within 30 seconds]');
  conversationHistory.push({ role: 'user', content: '[The candidate did not respond within 30 seconds — treat this as if they did not know the answer and move on]' });
  answerInput.value = '';
  speechBuffer = '';

  const nudges = selectedLanguage === 'hinglish'
    ? [
        'Koi baat nahi, isko chhodte hain — chalo agle sawaal par badhte hain.',
        'Theek hai, lagta hai yeh thoda tricky tha. Chalo next question try karte hain.',
        'Kaafi time ho gaya — hum is question ko yahin chhod dete hain aur aage badhte hain.'
      ]
    : [
        "That's okay — let's move on to the next question.",
        "No worries, let's try a different one instead.",
        "Let's leave that one for now and keep moving."
      ];
  const nudgeMsg = nudges[Math.floor(Math.random() * nudges.length)];
  document.getElementById('aiBubble').textContent = nudgeMsg;
  speakAsInterviewer(nudgeMsg, async () => { await loadNextQuestion(); });
}

function autoStartListening() {
  // Fresh chance every question — a network blip or hardware hiccup on one
  // answer shouldn't silently kill voice input for the rest of the interview.
  voiceInputDisabled = false;
  recentRecognitionErrors = [];

  if (!recognition) setupSpeechRecognition();

  // पुरानी recognition बंद करो — fresh start
  isListening = false;
  recognitionRunning = false;
  try { if (recognition) recognition.abort(); } catch(e) {}

  speechBuffer = '';
  const textarea = document.getElementById('answerInput');
  if (textarea) textarea.value = '';

  // Fresh turn — let the low-volume nudge re-trigger if needed for this answer
  lowVolumeStreakMs = 0;
  lowVolumeNudgedThisTurn = false;

  if (voiceInputDisabled) return; // setupSpeechRecognition just found this browser can't do voice at all

  // थोड़ी देर बाद fresh start
  setTimeout(() => {
    if (voiceInputDisabled) return; // an error landed in the gap before this fired
    isListening = true;
    startFreshRecognition();
    armSilenceWatcher();
  }, 200);

  const btn = document.getElementById('speakBtn');
  if (btn) { btn.textContent = '🎙️ Mic Active'; btn.classList.add('active'); }
  const status = document.getElementById('speechStatus');
  if (status) {
    status.textContent = '🎙️ Listening... speak your answer';
    status.className = 'speech-status listening';
  }
}

function stopListening() {
  isListening = false;
  recognitionRunning = false;
  clearSilenceWatcher();
  // recognition abort करो — Arjun बोलते वक्त सुनना बंद
  try { if (recognition) recognition.abort(); } catch(e) {}

  if (voiceInputDisabled) return; // keep the explanation on screen instead of the normal "Done" status

  const btn = document.getElementById('speakBtn');
  if (btn) { btn.textContent = '🎙️ Start Speaking'; btn.classList.remove('active'); }
  const status = document.getElementById('speechStatus');
  if (status) {
    status.textContent = '✅ Done — review and submit.';
    status.className = 'speech-status stopped';
  }
}

// Manual mic control removed entirely — autoStartListening/stopListening are
// system-driven only (fired around each question and answer). Previously a
// "Start/Stop Speaking" button let candidates kill the silence watchdog and
// sit silent indefinitely with zero consequence; that control no longer exists.

// ════════════════════════════════════════════════
// SANITIZE AI TEXT — the LLM occasionally slips in markdown formatting
// (**bold**, *italics*, # headers, `code`, bullet dashes) even though this
// text is meant to be spoken aloud and shown as plain conversational
// captions. Strip that formatting so it never renders/speaks literally
// (e.g. "Arjun**, Hey" instead of "Arjun, Hey").
// ════════════════════════════════════════════════
function sanitizeAiText(text) {
  if (!text) return text;
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')   // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold**
    .replace(/\*(.+?)\*/g, '$1')           // *italics*
    .replace(/__(.+?)__/g, '$1')           // __bold__
    .replace(/_(.+?)_/g, '$1')             // _italics_
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // `code` / ```code```
    .replace(/^#{1,6}\s+/gm, '')           // # headers
    .replace(/^[-*]\s+/gm, '')             // - bullet / * bullet
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ════════════════════════════════════════════════
// AI INTERVIEWER — GROQ
// ════════════════════════════════════════════════