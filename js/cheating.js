// ════════════════════════════════════════════════
// HireView AI — Cheating Detection
// ════════════════════════════════════════════════

let tabSwitchCount = 0;
let windowBlurCount = 0;
let multipleFaceCount = 0;
let totalFaceChecks = 0;
let cheatSignals = [];

// Camera presence — gates interview start and ends the session if the
// candidate disappears from frame mid-interview
let faceDetectionAvailable = false;
let currentFaceCount = 0;
let noFaceStartTime = null;
const NO_FACE_TERMINATE_MS = 8000; // 8s continuously with nobody in frame → end interview

function setupCheatDetection() {
  // Tab switching
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !interviewEnded) {
      tabSwitchCount++;
      cheatSignals.push({ type: 'tab_switch', count: tabSwitchCount, time: getElapsedMinutes() });
      showCheatWarning(`Tab switch detected! (${tabSwitchCount} time${tabSwitchCount > 1 ? 's' : ''})`);
      if (tabSwitchCount > 2) handleCheatLimitExceeded('tab_switch');
    }
  });

  // Window blur — 15 seconds बाद track करें
  let blurTrackingActive = false;
  setTimeout(() => { blurTrackingActive = true; }, 15000);

  window.addEventListener('blur', () => {
    if (!interviewEnded && blurTrackingActive) {
      windowBlurCount++;
      cheatSignals.push({ type: 'window_blur', count: windowBlurCount, time: getElapsedMinutes() });
      showCheatWarning(`Window switched ${windowBlurCount} times — please stay on this page.`);
      if (windowBlurCount > 2) handleCheatLimitExceeded('window_blur');
    }
  });
} // ← setupCheatDetection यहाँ बंद होता है

// ════════════════════════════════════════════════
// FACE DETECTION (MediaPipe)
// ════════════════════════════════════════════════
async function setupFaceDetection() {
  try {
    if (typeof FaceDetection === 'undefined') {
      console.log('FaceDetection not available — will work on HTTPS after deploy.');
      return;
    }
    const faceDetection = new FaceDetection({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
    });
    faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 });
    faceDetectionAvailable = true;
    faceDetection.onResults((results) => {
      if (interviewEnded) return;
      totalFaceChecks++;
      const faceCount = results.detections ? results.detections.length : 0;
      currentFaceCount = faceCount;

      if (faceCount === 0) {
        if (!noFaceStartTime) noFaceStartTime = Date.now();
        // Only auto-terminate once the interview has actually started (avoids
        // false triggers during the initial camera-warmup / pre-start check)
        if (interviewStartTime && Date.now() - noFaceStartTime >= NO_FACE_TERMINATE_MS) {
          handleCheatLimitExceeded('no_face');
        }
      } else {
        noFaceStartTime = null;
      }

      if (faceCount > 1) {
        multipleFaceCount++;
        cheatSignals.push({ type: 'multiple_faces', count: faceCount, time: getElapsedMinutes() });
        showCheatWarning(`Multiple faces detected! (${faceCount} people on camera)`);
        if (multipleFaceCount > 3) handleCheatLimitExceeded('multiple_faces');
      }
    });
    const video = document.getElementById('candidateVideo');
    const mpCamera = new Camera(video, {
      onFrame: async () => { await faceDetection.send({ image: video }); },
      width: 320, height: 240
    });
    mpCamera.start();
    console.log('MediaPipe face detection active.');
  } catch (err) {
    console.log('Face detection not available:', err.message);
  }
}

function stopFaceDetection() {
  console.log('Face detection stopped.');
}

// Blocks interview start until a face is seen on camera (or gives up
// gracefully if face detection itself isn't available in this browser —
// we shouldn't block a real candidate just because MediaPipe failed to load).
function waitForInitialFacePresence(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!faceDetectionAvailable) { resolve(true); return; }
      if (currentFaceCount > 0) { resolve(true); return; }
      if (Date.now() - start >= timeoutMs) { resolve(false); return; }
      setTimeout(check, 400);
    };
    check();
  });
}

// ════════════════════════════════════════════════
// BACKGROUND INTEGRITY AUDIO MONITOR
// Runs for the whole interview, independent of the "Mic On/Off" UI toggle
// and independent of whether SpeechRecognition is actively capturing an
// answer. It's a volume-level heuristic (RMS of the raw mic signal), NOT
// speaker identification — it flags sustained voice-level audio activity
// during moments that aren't the candidate's turn to speak (i.e. while
// Arjun is talking, or while the candidate has muted/hasn't started
// answering yet). That's a signal worth a human reviewing, not proof of
// cheating by itself — thresholds below are a starting point and should be
// tuned against real mic/room conditions before relying on them.
// ════════════════════════════════════════════════
let monitorAudioCtx = null;
let monitorAnalyser = null;
let monitorDataArray = null;
let monitorTimerId = null;
let offTurnVoiceMs = 0;
let offTurnFlagCount = 0;
const OFF_TURN_ENERGY_THRESHOLD = 0.02; // heuristic RMS threshold — tune after real testing
const OFF_TURN_FLAG_MS = 4000;          // ~4s of sustained off-turn activity before it counts as one flag

function startIntegrityAudioMonitor() {
  if (!mediaStream || monitorAudioCtx) return;
  try {
    monitorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = monitorAudioCtx.createMediaStreamSource(mediaStream);
    monitorAnalyser = monitorAudioCtx.createAnalyser();
    monitorAnalyser.fftSize = 2048;
    monitorDataArray = new Uint8Array(monitorAnalyser.fftSize);
    source.connect(monitorAnalyser);

    const tick = () => {
      if (interviewEnded) { stopIntegrityAudioMonitor(); return; }
      monitorAnalyser.getByteTimeDomainData(monitorDataArray);
      let sumSquares = 0;
      for (let i = 0; i < monitorDataArray.length; i++) {
        const v = (monitorDataArray[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / monitorDataArray.length);

      const isCandidateTurn = isListening; // candidate is actively expected to be speaking (mic is no longer user-toggleable)
      if (!isCandidateTurn && rms > OFF_TURN_ENERGY_THRESHOLD) {
        offTurnVoiceMs += 100;
        if (offTurnVoiceMs >= OFF_TURN_FLAG_MS) {
          offTurnVoiceMs = 0;
          offTurnFlagCount++;
          cheatSignals.push({ type: 'off_turn_audio', count: offTurnFlagCount, time: getElapsedMinutes() });
          if (offTurnFlagCount > 3) {
            showCheatWarning('Background voice activity detected while it was not your turn to speak.');
          }
        }
      } else {
        offTurnVoiceMs = Math.max(0, offTurnVoiceMs - 200);
      }

      monitorTimerId = setTimeout(tick, 100);
    };
    tick();
  } catch (err) {
    console.log('Integrity audio monitor unavailable:', err.message);
  }
}

function stopIntegrityAudioMonitor() {
  if (monitorTimerId) { clearTimeout(monitorTimerId); monitorTimerId = null; }
  if (monitorAudioCtx) { try { monitorAudioCtx.close(); } catch (e) {} monitorAudioCtx = null; }
}

function getOffTurnAudioReport() {
  if (offTurnFlagCount === 0) return null;
  return { off_turn_flags: offTurnFlagCount };
}

function showCheatWarning(msg) {
  let warn = document.getElementById('cheatWarning');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'cheatWarning';
    warn.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:white;padding:0.75rem 1.5rem;border-radius:12px;font-weight:700;font-size:0.9rem;z-index:9999;box-shadow:0 4px 20px rgba(239,68,68,0.5);text-align:center;';
    document.body.appendChild(warn);
  }
  warn.textContent = `⚠️ ${msg}`;
  warn.style.display = 'block';
  setTimeout(() => { if (warn) warn.style.display = 'none'; }, 4000);
}

function handleCheatLimitExceeded(type) {
  if (interviewEnded) return;

  const messages = {
    multiple_faces: {
      warning: '🚨 Interview Terminated — Multiple people detected more than 3 times.',
      arjun: selectedLanguage === 'hinglish'
        ? 'Maafi chahta hoon, lekin multiple baar camera par ek se zyada log detect hue. Integrity violation ke kaaran session terminate ho raha hai.'
        : 'I am sorry, but multiple people were detected on camera more than 3 times. This violates our integrity policy — session terminated.'
    },
    no_face: {
      warning: '🚨 Interview Terminated — No one detected in front of the camera.',
      arjun: selectedLanguage === 'hinglish'
        ? 'Aap kaafi der se camera ke saamne nazar nahi aa rahe the. Integrity policy ke kaaran session terminate ho raha hai.'
        : 'You were not visible on camera for too long. This violates our integrity policy — session terminated.'
    },
    tab_switch: {
      warning: '🚨 Interview Terminated — Too many tab switches.',
      arjun: selectedLanguage === 'hinglish'
        ? 'Aapne bahut baar tab switch kiya hai. Integrity violation ke kaaran session terminate ho raha hai.'
        : 'You have switched tabs too many times. This is an integrity violation — session terminated.'
    },
    window_blur: {
      warning: '🚨 Interview Terminated — Too many window switches.',
      arjun: selectedLanguage === 'hinglish'
        ? 'Aapne bahut baar window switch kiya hai. Integrity violation ke kaaran session terminate ho raha hai.'
        : 'You have switched windows too many times. This is an integrity violation — session terminated.'
    }
  };

  const m = messages[type] || messages['tab_switch'];
  showCheatWarning(m.warning);
  document.getElementById('aiBubble').textContent = m.arjun;

  // Backend को notify करें — status cheating_terminated set करें
  if (currentInterviewId && authToken) {
    fetch(`${BACKEND_URL}/api/interviews/${currentInterviewId}/terminate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    }).catch(err => console.error('Could not terminate interview on backend:', err));
  }

  speakAsInterviewer(m.arjun, async () => { await endInterview(false); });
}

function getFaceDetectionReport() {
  if (totalFaceChecks === 0) return null;
  return {
    multiple_face_detections: multipleFaceCount,
    total_checks: totalFaceChecks,
    percentage: Math.round((multipleFaceCount / totalFaceChecks) * 100)
  };
}

function getElapsedMinutes() {
  if (!interviewStartTime) return 0;
  return Math.round((Date.now() - interviewStartTime) / 60000 * 10) / 10;
}

function getFullIntegrityReport() {
  const faceReport = getFaceDetectionReport();
  const timingReport = (typeof analyzeResponseTimingConsistency === 'function')
    ? analyzeResponseTimingConsistency() : null;
  const audioReport = getOffTurnAudioReport();
  const totalFlags =
    tabSwitchCount +
    (windowBlurCount > 2 ? windowBlurCount - 2 : 0) +
    (faceReport?.multiple_face_detections || 0) +
    (timingReport?.suspicious ? 3 : 0) +
    (audioReport?.off_turn_flags || 0) * 2;
  const integrityScore = Math.max(0, Math.min(100, 100 - totalFlags * 8));
  return {
    integrity_score: integrityScore,
    tab_switches: tabSwitchCount,
    window_switches: windowBlurCount,
    face_detection: faceReport,
    response_timing: timingReport,
    off_turn_audio: audioReport,
    total_flags: totalFlags,
    verdict: totalFlags === 0 ? 'Clean'
      : totalFlags <= 2 ? 'Minor Concerns'
      : totalFlags <= 5 ? 'Suspicious' : 'High Risk'
  };
}