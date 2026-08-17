// ════════════════════════════════════════════════
// Extracted from the original monolithic interview.js during Phase 0
// architecture cleanup. Still classic global-scope scripts (no ES
// modules / bundler introduced) — order of <script> tags in
// interview.html matters and must match the order below:
//   state.js -> setup.js -> media.js -> speech.js -> conversation.js -> recording.js
// ════════════════════════════════════════════════

function showSetupError(msg) {
    const el = document.getElementById('setupError');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 4000);
  }
  
  function showSetupErrorGov(msg) {
    const el = document.getElementById('setupErrorGov');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 4000);
  }
  
  // Free-trial quota used up (backend returns 402) — unlike a normal setup
  // error this doesn't auto-hide after 4s, and it links straight to the
  // Payment & Subscription page instead of just stating the problem.
  function showQuotaExceededError(sector, msg, showPlansLink = true) {
    const elId = sector === 'private' ? 'setupError' : 'setupErrorGov';
    const el = document.getElementById(elId);
    el.innerHTML = `
      <div>${msg}</div>
      ${showPlansLink ? `<button onclick="window.location.href='/dashboard?openPayment=1'"
        style="margin-top:0.75rem;padding:0.6rem 1.4rem;background:linear-gradient(135deg,#6366f1,#ec4899);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.85rem">
        View Plans →
      </button>` : ''}`;
    el.classList.add('show');
  }
  
  // ════════════════════════════════════════════════
  // INTERVIEW START
  // ════════════════════════════════════════════════
  async function handleInterviewStart(sector) {
    let jobTitle = '';
    let governmentDomain = null;
    let governmentRole = null;
    let biodataToSend = null;
    let candidateSummary = null;
    let targetCompany = null;
    let interviewRound = 'mixed';
  
    if (sector === 'private') {
      const hasJd = jdText && jdText.trim().length >= 20;
      const domainVal = document.getElementById('privateDomain').value;
  
      if (!hasJd) {
        // No JD given — domain and role stay mandatory, same as before
        if (!domainVal) { showSetupError('Please select a job domain first.'); return; }
        if (domainVal === 'other' && !getPrivateJobDomain()) { showSetupError('Please specify your job domain.'); return; }
        jobTitle = getPrivateJobRole();
        if (!jobTitle) { showSetupError('Please select or specify a job role.'); return; }
      } else {
        // JD given — domain/role become optional; fall back to a safe label the backend accepts
        if (domainVal === 'other' && !getPrivateJobDomain()) { showSetupError('Please specify your job domain, or clear it and rely on the JD.'); return; }
        if (domainVal && domainVal !== 'other') {
          const roleVal = document.getElementById('privateRole').value;
          if (roleVal === '__other__' && !getPrivateJobRole()) { showSetupError('Please specify your job role, or clear it and rely on the JD.'); return; }
        }
        jobTitle = getPrivateJobRole() || 'Role as per uploaded Job Description';
      }
      if (!resumeText) { showSetupError('Please upload your resume first.'); return; }
      selectedLanguage = document.getElementById('interviewLanguagePrivate').value;
      targetCompany = getTargetCompany() || null;
      interviewRound = getInterviewRound();
      currentInterviewRound = interviewRound;
    } else {
      governmentDomain = document.getElementById('governmentDomain').value;
      governmentRole = document.getElementById('governmentRole').value;
      if (!governmentDomain || !governmentRole) { showSetupErrorGov('Please select a government job domain and role.'); return; }
      if (!biodataSource) { showSetupErrorGov('Please choose to upload biodata or fill the form.'); return; }
  
      if (biodataSource === 'upload') {
        if (!biodataText) { showSetupErrorGov('Please upload your biodata first.'); return; }
        biodataToSend = biodataText;
      } else {
        biodataToSend = collectBiodataFromForm();
      }
  
      candidateSummary = document.getElementById('candidateSummary').value;
      jobTitle = governmentRole;
      selectedLanguage = document.getElementById('interviewLanguageGov').value;
      currentInterviewRound = 'mixed'; // round selection is private-sector only
    }
  
    try {
      const res = await fetch(`${BACKEND_URL}/api/interviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          role: jobTitle,
          difficulty: 'adaptive',
          duration_limit: 3600,
          sector: sector,
          government_domain: governmentDomain,
          government_role: governmentRole,
          biodata: biodataToSend,
          biodata_source: biodataSource,
          candidate_summary: candidateSummary,
          target_company: targetCompany,
          interview_round: interviewRound
        })
      });
  
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 402) {
          const errorCode = err.detail?.error_code;
          const message = err.detail?.message || err.detail || "You've reached your interview limit.";
          // "View Plans" only makes sense for someone who doesn't have a paid
          // plan yet — a paying user hitting the daily cap already has one,
          // so just show the plain message with no upsell button.
          showQuotaExceededError(sector, message, /* showPlansLink */ errorCode !== 'daily_limit_exceeded');
        } else if (sector === 'private') {
          showSetupError(err.detail?.message || err.detail || 'Could not start interview. Please try again.');
        } else {
          showSetupErrorGov(err.detail?.message || err.detail || 'Could not start interview. Please try again.');
        }
        return;
      }
  
      const data = await res.json();
      currentInterviewId = data.id;
      showPage('activeInterviewPage');
      await setupCameraAndMic();
  
    } catch (err) {
      console.error('Network error:', err);
      if (sector === 'private') {
        showSetupError('Could not reach the server. Is the backend running?');
      } else {
        showSetupErrorGov('Could not reach the server. Is the backend running?');
      }
    }
  }
  
  // ════════════════════════════════════════════════
  // CAMERA & MIC
  // ════════════════════════════════════════════════
  async function setupCameraAndMic() {
    try {
      if (mediaStream) return;
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Without this, several Android phones default to the REAR
          // camera for a plain `video:true` request — wrong camera for a
          // face-to-camera interview. 'user' (not 'exact') is a soft
          // preference, so desktop webcams (no front/back concept) still
          // work fine and don't throw.
          facingMode: 'user',
          // Keeps capture at a sane size instead of a device's max
          // resolution, which can lag lower-end Android phones.
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true   // helps boost genuinely quiet speakers at the OS/browser level
        }
      });
      const video = document.getElementById('candidateVideo');
      video.srcObject = mediaStream;
      video.classList.add('active');
      document.getElementById('cameraPlaceholder').classList.add('hidden');
      // Recording शुरू करें
      startRecording();
  
      setupSpeechRecognition();
      startVolumeMonitor();
      if (typeof setupFaceDetection === 'function') setupFaceDetection();
  
      document.getElementById('aiBubble').textContent = "Checking that I can see you clearly on camera before we begin...";
  
      const facePresent = (typeof waitForInitialFacePresence === 'function')
        ? await waitForInitialFacePresence()
        : true;
  
      if (!facePresent) {
        showFaceCheckFailed();
        return;
      }
  
      beginInterviewSession();
  
    } catch (err) {
      console.error('Camera/mic error:', err);
      cameraUnavailable = true;
      document.getElementById('cameraPlaceholder').innerHTML =
        '<div style="font-size:0.85rem;color:rgba(255,255,255,0.5);padding:1rem;text-align:center">Camera/mic access denied. You can still continue by typing.</div>';
      startInterviewTimer();
      setupCheatDetection();
      setTimeout(() => loadFirstQuestion(), 2000);
    }
  }
  
  // Shown when the candidate isn't visible on camera within the initial check window
  function showFaceCheckFailed() {
    document.getElementById('aiBubble').textContent =
      "I can't see you clearly on camera. Please make sure you're well-lit and centered in frame, then try again.";
  
    const container = document.getElementById('faceCheckRetryContainer');
    if (!container) return;
    container.innerHTML = '';
    const retryBtn = document.createElement('button');
    retryBtn.id = 'faceRetryBtn';
    retryBtn.className = 'primary-btn';
    retryBtn.textContent = "I'm Ready — Check Again";
    retryBtn.onclick = async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Checking...';
      const ok = await waitForInitialFacePresence(8000);
      if (ok) {
        container.innerHTML = '';
        beginInterviewSession();
      } else {
        retryBtn.disabled = false;
        retryBtn.textContent = "I'm Ready — Check Again";
      }
    };
    container.appendChild(retryBtn);
  }
  
  // Camera confirmed — start the actual interview flow (cheat detection, timer, first question)
  function beginInterviewSession() {
    setupCheatDetection();
    if (typeof startIntegrityAudioMonitor === 'function') startIntegrityAudioMonitor();
    startInterviewTimer();
  
    setTimeout(() => {
      const settleMsg = selectedLanguage === 'hinglish'
        ? `Namaste! Main ${INTERVIEWER_NAME} hoon. Kya aap comfortable hain? Sab settle ho gaya? Toh chaliye shuru karte hain.`
        : `Hi there! I'm ${INTERVIEWER_NAME}. Hope everything's set on your end — camera, mic, all good? Great, let's get started!`;
  
      document.getElementById('aiBubble').textContent = settleMsg;
  
      const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) { setTimeout(trySpeak, 500); return; }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(settleMsg);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = getLangConfig().speechLang;
        utterance.rate = 0.92;
        utterance.pitch = 1.0;
        const dot = document.getElementById('avatarDot');
        const statusText = document.getElementById('avatarStatusText');
        utterance.onstart = () => { dot.classList.add('speaking'); statusText.textContent = 'Speaking...'; };
        utterance.onend = () => {
          dot.classList.remove('speaking');
          statusText.textContent = 'Listening...';
          setTimeout(() => loadFirstQuestion(), 800);
        };
        utterance.onerror = () => setTimeout(() => loadFirstQuestion(), 800);
        window.speechSynthesis.speak(utterance);
      };
      trySpeak();
    }, 3000);
  }
  
  function toggleCamera() {
    if (!mediaStream) return;
    cameraOn = !cameraOn;
    mediaStream.getVideoTracks().forEach(track => track.enabled = cameraOn);
    const btn = document.getElementById('toggleCameraBtn');
    btn.textContent = cameraOn ? '📷 Camera On' : '📷 Camera Off';
    btn.classList.toggle('active', cameraOn);
  }
  
  // Mic is no longer user-toggleable — the system alone decides when it's
  // listening for an answer (isListening, driven by autoStartListening/
  // stopListening). The raw audio track always stays live so every sound in
  // the room is captured for the full session, per integrity requirements.
  
  // ════════════════════════════════════════════════
  // VOICE — TTS
  // ════════════════════════════════════════════════