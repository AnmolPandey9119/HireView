// ════════════════════════════════════════════════
// HireView AI — Cheating Detection
// ════════════════════════════════════════════════

let tabSwitchCount = 0;
let windowBlurCount = 0;
let multipleFaceCount = 0;
let totalFaceChecks = 0;
let cheatSignals = [];

function setupCheatDetection() {
  // Tab switching
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !interviewEnded) {
      tabSwitchCount++;
      cheatSignals.push({ type: 'tab_switch', count: tabSwitchCount, time: getElapsedMinutes() });
      showCheatWarning(`Tab switch detected! (${tabSwitchCount} time${tabSwitchCount > 1 ? 's' : ''})`);
      if (tabSwitchCount > 5) handleCheatLimitExceeded('tab_switch');
    }
  });

  // Window blur — 15 seconds बाद track करें
  let blurTrackingActive = false;
  setTimeout(() => { blurTrackingActive = true; }, 15000);

  window.addEventListener('blur', () => {
    if (!interviewEnded && blurTrackingActive) {
      windowBlurCount++;
      cheatSignals.push({ type: 'window_blur', count: windowBlurCount, time: getElapsedMinutes() });
      if (windowBlurCount > 3) {
        showCheatWarning(`Window switched ${windowBlurCount} times — please stay on this page.`);
      }
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
    faceDetection.onResults((results) => {
      if (interviewEnded) return;
      totalFaceChecks++;
      const faceCount = results.detections ? results.detections.length : 0;
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
    tab_switch: {
      warning: '🚨 Interview Terminated — Too many tab switches.',
      arjun: selectedLanguage === 'hinglish'
        ? 'Aapne bahut baar tab switch kiya hai. Integrity violation ke kaaran session terminate ho raha hai.'
        : 'You have switched tabs too many times. This is an integrity violation — session terminated.'
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
  const totalFlags =
    tabSwitchCount +
    (windowBlurCount > 2 ? windowBlurCount - 2 : 0) +
    (faceReport?.multiple_face_detections || 0) +
    (timingReport?.suspicious ? 3 : 0);
  const integrityScore = Math.max(0, Math.min(100, 100 - totalFlags * 8));
  return {
    integrity_score: integrityScore,
    tab_switches: tabSwitchCount,
    window_switches: windowBlurCount,
    face_detection: faceReport,
    response_timing: timingReport,
    total_flags: totalFlags,
    verdict: totalFlags === 0 ? 'Clean'
      : totalFlags <= 2 ? 'Minor Concerns'
      : totalFlags <= 5 ? 'Suspicious' : 'High Risk'
  };
}