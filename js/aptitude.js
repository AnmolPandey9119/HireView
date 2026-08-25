/* ════════════════════════════════════════════════
   HireView — Aptitude Test page
   Talks to /api/aptitude* (routes/aptitude.py). Mirrors the same
   trust model as js/questionbank.js: /start never returns
   correct_index/explanation, grading only ever happens server-side
   in /submit — this file just renders whatever comes back.
   ════════════════════════════════════════════════ */

if (!authToken) window.location.href = '/auth';

let aptSelectedTopic = '';
let aptSelectedDifficulty = '';
let aptSelectedCount = 10;

let aptAttemptId = null;
let aptQuestions = [];       // questions for the current attempt (no answers)
let aptCurrentIndex = 0;
let aptSelections = {};      // questionId -> selected index (in-progress, client-side only until submit)
let aptSecondsPerQuestion = 45;
let aptSecondsRemaining = 0;
let aptTimerInterval = null;
let aptStartedAt = null;
let aptSubmitting = false;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

let toastTimer = null;
function showToast(message, isError) {
  const toast = document.getElementById('hvToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 3500 : 2500);
}

async function apiGet(path) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

function showScreen(name) {
  document.getElementById('aptSetupScreen').style.display = name === 'setup' ? '' : 'none';
  document.getElementById('aptTestScreen').style.display = name === 'test' ? '' : 'none';
  document.getElementById('aptResultsScreen').style.display = name === 'results' ? '' : 'none';
  document.getElementById('aptLoadingWrap').style.display = name === 'loading' ? '' : 'none';
}

// ────────────────────────────────────────────
// Setup screen
// ────────────────────────────────────────────
async function loadTopicsForSetup() {
  try {
    const data = await apiGet('/api/questions/topics?category=aptitude');
    const select = document.getElementById('aptTopicSelect');
    Object.keys(data.topics || {}).sort().forEach(topic => {
      const counts = data.topics[topic];
      const total = (counts.easy || 0) + (counts.medium || 0) + (counts.hard || 0);
      const opt = document.createElement('option');
      opt.value = topic;
      opt.textContent = `${topic.replace(/_/g, ' ')} (${total})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
    // Non-fatal — "All topics" still works fine without this list.
  }
}

document.getElementById('aptTopicSelect').addEventListener('change', (e) => {
  aptSelectedTopic = e.target.value;
});
document.getElementById('aptDifficultySelect').addEventListener('change', (e) => {
  aptSelectedDifficulty = e.target.value;
});
document.getElementById('aptCountRow').addEventListener('click', (e) => {
  const chip = e.target.closest('.apt-count-chip');
  if (!chip) return;
  document.querySelectorAll('.apt-count-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  aptSelectedCount = parseInt(chip.dataset.count, 10);
});

document.getElementById('aptStartBtn').addEventListener('click', startTest);

async function startTest() {
  const btn = document.getElementById('aptStartBtn');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const data = await apiPost('/api/aptitude/start', {
      topic: aptSelectedTopic || null,
      difficulty: aptSelectedDifficulty || null,
      count: aptSelectedCount,
    });

    aptAttemptId = data.attempt_id;
    aptQuestions = data.questions;
    aptCurrentIndex = 0;
    aptSelections = {};
    aptSecondsPerQuestion = Math.round((data.suggested_duration_seconds || aptQuestions.length * 45) / aptQuestions.length) || 45;
    aptStartedAt = Date.now();

    showScreen('test');
    renderQuestion();
    startTimer();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't start the test. Try a different topic/difficulty.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Test →';
  }
}

// ────────────────────────────────────────────
// Timer — counts down for the whole test (total budget), not per
// question, so a candidate can spend longer on hard ones and less
// on easy ones, same as a real aptitude round.
// ────────────────────────────────────────────
function startTimer() {
  aptSecondsRemaining = aptSecondsPerQuestion * aptQuestions.length;
  updateTimerDisplay();
  clearInterval(aptTimerInterval);
  aptTimerInterval = setInterval(() => {
    aptSecondsRemaining--;
    updateTimerDisplay();
    if (aptSecondsRemaining <= 0) {
      clearInterval(aptTimerInterval);
      showToast("Time's up — submitting your answers.", false);
      finishTest();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('aptTimer');
  const m = Math.floor(aptSecondsRemaining / 60);
  const s = aptSecondsRemaining % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', aptSecondsRemaining <= 30);
}

// ────────────────────────────────────────────
// Test-taking screen
// ────────────────────────────────────────────
function renderQuestion() {
  const q = aptQuestions[aptCurrentIndex];
  const card = document.getElementById('aptQuestionCard');
  const selected = aptSelections[q.id];

  const optionsHtml = q.options.map((opt, i) => `
    <button class="apt-option ${selected === i ? 'selected' : ''}" data-index="${i}">${escapeHtml(opt)}</button>
  `).join('');

  const isLast = aptCurrentIndex === aptQuestions.length - 1;

  card.innerHTML = `
    <div class="apt-q-tags">
      <span class="apt-topic-tag">${escapeHtml((q.topic || '').replace(/_/g, ' '))}</span>
      <span class="apt-diff apt-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
    </div>
    <div class="apt-q-prompt">${escapeHtml(q.prompt)}</div>
    <div class="apt-options" id="aptOptionsWrap">${optionsHtml}</div>
    <div class="apt-nav-row">
      <button class="secondary-btn" id="aptPrevBtn" ${aptCurrentIndex === 0 ? 'disabled' : ''}>← Previous</button>
      <div class="spacer"></div>
      ${isLast
        ? `<button class="start-btn" id="aptSubmitBtn">Submit Test ✓</button>`
        : `<button class="start-btn" id="aptNextBtn">Next →</button>`}
    </div>
  `;

  document.getElementById('aptOptionsWrap').addEventListener('click', (e) => {
    const btn = e.target.closest('.apt-option');
    if (!btn) return;
    aptSelections[q.id] = parseInt(btn.dataset.index, 10);
    document.querySelectorAll('#aptOptionsWrap .apt-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  const prevBtn = document.getElementById('aptPrevBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => { aptCurrentIndex--; renderQuestion(); });

  const nextBtn = document.getElementById('aptNextBtn');
  if (nextBtn) nextBtn.addEventListener('click', () => { aptCurrentIndex++; renderQuestion(); });

  const submitBtn = document.getElementById('aptSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', finishTest);

  document.getElementById('aptProgressText').textContent = `Question ${aptCurrentIndex + 1} of ${aptQuestions.length}`;
  document.getElementById('aptProgressFill').style.width = `${((aptCurrentIndex + 1) / aptQuestions.length) * 100}%`;
}

async function finishTest() {
  if (aptSubmitting) return;
  aptSubmitting = true;
  clearInterval(aptTimerInterval);
  showScreen('loading');

  const answers = Object.keys(aptSelections).map(qid => ({
    question_id: parseInt(qid, 10),
    selected_index: aptSelections[qid],
  }));
  const timeTaken = Math.round((Date.now() - aptStartedAt) / 1000);

  try {
    const result = await apiPost(`/api/aptitude/${aptAttemptId}/submit`, {
      answers,
      time_taken_seconds: timeTaken,
    });
    renderResults(result);
    showScreen('results');
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't submit your test. Please try again.", true);
    showScreen('test');
  } finally {
    aptSubmitting = false;
  }
}

// ────────────────────────────────────────────
// Results screen
// ────────────────────────────────────────────
function scoreColor(pct) {
  if (pct >= 70) return 'var(--hv-success)';
  if (pct >= 40) return 'var(--hv-warning)';
  return 'var(--hv-error-light)';
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderResults(result) {
  const wrap = document.getElementById('aptResultsScreen');
  const color = scoreColor(result.score_percent);

  const reviewHtml = result.questions.map((q, i) => {
    const optionsHtml = q.options.map((opt, idx) => {
      let cls = 'apt-option';
      if (idx === q.correct_index) cls += ' correct';
      else if (idx === q.selected_index) cls += ' incorrect';
      return `<div class="${cls}" style="cursor:default;">${escapeHtml(opt)}</div>`;
    }).join('');

    return `
      <div class="apt-review-card">
        <div class="apt-q-tags">
          <span class="apt-topic-tag">${escapeHtml((q.topic || '').replace(/_/g, ' '))}</span>
          <span class="apt-diff apt-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
          <span class="apt-diff" style="background:${q.is_correct ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color:${q.is_correct ? 'var(--hv-success)' : 'var(--hv-error-light)'}">${q.is_correct ? '✅ Correct' : '❌ Incorrect'}</span>
        </div>
        <div class="apt-q-prompt" style="font-size:1.05rem;">Q${i + 1}. ${escapeHtml(q.prompt)}</div>
        ${q.selected_index == null ? '<div class="apt-unanswered-note">You didn\'t answer this one.</div>' : ''}
        <div class="apt-options">${optionsHtml}</div>
        ${q.explanation ? `<div class="apt-explanation">${escapeHtml(q.explanation)}</div>` : ''}
      </div>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="apt-results-summary">
      <div class="apt-score-ring" style="color:${color}">${result.score_percent}%</div>
      <div class="apt-score-sub">${result.correct_count} of ${result.total_questions} correct</div>
      <div class="apt-stats-row">
        <div class="apt-stat-chip">
          <div class="apt-stat-chip-value" style="color:${color}">${result.correct_count}/${result.total_questions}</div>
          <div class="apt-stat-chip-label">Score</div>
        </div>
        <div class="apt-stat-chip">
          <div class="apt-stat-chip-value" style="color:#818cf8">${formatDuration(result.time_taken_seconds)}</div>
          <div class="apt-stat-chip-label">Time Taken</div>
        </div>
        <div class="apt-stat-chip">
          <div class="apt-stat-chip-value" style="color:#ec4899">${escapeHtml(result.difficulty || 'Mixed')}</div>
          <div class="apt-stat-chip-label">Difficulty</div>
        </div>
      </div>
      <div class="apt-results-actions">
        <button class="secondary-btn" onclick="window.location.href='/history'">View in My Reports</button>
        <button class="start-btn" onclick="resetToSetup()">Take Another Test</button>
      </div>
    </div>
    <div class="apt-review-title">📋 Question Review</div>
    ${reviewHtml}
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetToSetup() {
  aptAttemptId = null;
  aptQuestions = [];
  aptSelections = {};
  aptCurrentIndex = 0;
  showScreen('setup');
}

// ────────────────────────────────────────────
// Init
// ────────────────────────────────────────────
loadTopicsForSetup();