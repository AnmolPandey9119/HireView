// ════════════════════════════════════════════════
// Extracted from the original monolithic interview.js during Phase 0
// architecture cleanup. Still classic global-scope scripts (no ES
// modules / bundler introduced) — order of <script> tags in
// interview.html matters and must match the order below:
//   state.js -> setup.js -> media.js -> speech.js -> conversation.js -> recording.js
// ════════════════════════════════════════════════

function startRecording() {
    if (!mediaStream) return;
    try {
      recordedChunks = [];
      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      try {
        mediaRecorder = new MediaRecorder(mediaStream, options);
      } catch(e) {
        mediaRecorder = new MediaRecorder(mediaStream);
      }
  
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
  
      mediaRecorder.start(1000); // हर 1 second में chunk save करो
      console.log('Recording started');
    } catch (err) {
      console.error('Recording error:', err);
    }
  }
  
  function stopRecording() {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        resolve(null); return;
      }
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }
  
  function showRecordingChoiceModal(onChoice) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; padding: 1rem;
    `;
    modal.innerHTML = `
      <div style="background: linear-gradient(135deg, #1a1f3a, #2d1b4e); border: 1px solid rgba(99,102,241,0.3);
        border-radius: 24px; padding: 2.5rem; max-width: 480px; width: 100%; text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
        <div style="font-size: 2rem; margin-bottom: 1rem">🎥</div>
        <h2 style="font-size: 1.4rem; font-weight: 800; color: white; margin-bottom: 0.75rem">
          Your interview has been recorded
        </h2>
        <p style="color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.6">
          What would you like to do with the recording?
        </p>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button onclick="handleRecordingChoice('download', this)" style="
            padding: 1rem 1.5rem; background: linear-gradient(135deg, #6366f1, #ec4899);
            border: none; border-radius: 14px; color: white; font-weight: 700;
            font-size: 0.95rem; cursor: pointer; font-family: inherit;">
            ⬇️ Download & Delete
          </button>
          <button onclick="handleRecordingChoice('none', this)" style="
            padding: 1rem 1.5rem; background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.15); border-radius: 14px;
            color: rgba(255,255,255,0.7); font-weight: 700; font-size: 0.95rem;
            cursor: pointer; font-family: inherit;">
            🗑️ Delete Recording
          </button>
        </div>
        <p style="color: rgba(255,255,255,0.3); font-size: 0.78rem; margin-top: 1.5rem">
          We never store your recording on our servers without your consent.
        </p>
      </div>`;
  
    document.body.appendChild(modal);
  
    window._recordingModalCallback = onChoice;
    window._recordingModal = modal;
  }
  
  async function handleRecordingChoice(choice, btn) {
    btn.disabled = true;
    btn.textContent = 'Processing...';
  
    const blob = await stopRecording();
  
    if (choice === 'download' && blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const role = selectedSector === 'government'
        ? document.getElementById('governmentRole').value
        : document.getElementById('privateRole').value;
      a.href = url;
      a.download = `hireview_${role.replace(/\s+/g, '_')}_${date}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  
    // Modal बंद करो
    if (window._recordingModal) {
      document.body.removeChild(window._recordingModal);
      window._recordingModal = null;
    }
  
    if (window._recordingModalCallback) {
      window._recordingModalCallback(choice);
      window._recordingModalCallback = null;
    }
  }