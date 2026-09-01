/* ════════════════════════════════════════════════
   HireView — Coding Round page
   Talks to /api/coding* (routes/coding.py), which compiles/runs the
   candidate's code via Piston (a sandboxed multi-language execution
   service — see models/piston_client.py) and grades it against the
   question's test cases. Hidden test cases' expected_output is never
   sent to the browser — same trust model as aptitude/questionbank.js.
   ════════════════════════════════════════════════ */

if (!authToken) window.location.href = '/auth';

let crSelectedTopic = '';
let crSelectedDifficulty = '';
let crSelectedCount = 3;
let crSelectedLanguage = 'c';
let crLanguages = []; // [{id, label, monaco_language}]

let crAttemptId = null;
let crQuestions = [];        // questions for the current round (no hidden test cases)
let crCurrentIndex = 0;
let crCodeByQuestion = {};   // questionId -> { language, code }
let crSolvedMap = {};        // questionId -> { passed_count, total_count, is_solved }
let crSecondsPerQuestion = 600; // 10 min/problem, matches the setup screen's hint
let crSecondsRemaining = 0;
let crTimerInterval = null;
let crStartedAt = null;
let crBusy = false;
let crEditor = null;

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
  document.getElementById('crSetupScreen').style.display = name === 'setup' ? '' : 'none';
  document.getElementById('crSolveScreen').style.display = name === 'solve' ? '' : 'none';
  document.getElementById('crResultsScreen').style.display = name === 'results' ? '' : 'none';
  document.getElementById('crLoadingWrap').style.display = name === 'loading' ? '' : 'none';
}

// ────────────────────────────────────────────
// CodeMirror mode per language
// ────────────────────────────────────────────
const CM_MODE = {
  c: 'text/x-csrc',
  cpp: 'text/x-c++src',
  java: 'text/x-java',
  python: 'python',
  javascript: 'javascript',
};

// ────────────────────────────────────────────
// Setup screen
// ────────────────────────────────────────────
async function loadTopicsForSetup() {
  try {
    const data = await apiGet('/api/questions/topics?category=coding');
    const select = document.getElementById('crTopicSelect');
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
  }
}

async function loadLanguages() {
  try {
    const data = await apiGet('/api/coding/languages');
    crLanguages = data.languages || [];
  } catch (err) {
    console.error(err);
    crLanguages = [{ id: 'c', label: 'C (GCC)', monaco_language: 'c' }];
  }
  const setupSelect = document.getElementById('crLanguageSelect');
  const editorSelect = document.getElementById('crEditorLangSelect');
  const optionsHtml = crLanguages.map(l => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('');
  setupSelect.innerHTML = optionsHtml;
  editorSelect.innerHTML = optionsHtml;
  crSelectedLanguage = crLanguages[0]?.id || 'c';
}

document.getElementById('crTopicSelect').addEventListener('change', (e) => { crSelectedTopic = e.target.value; });
document.getElementById('crDifficultySelect').addEventListener('change', (e) => { crSelectedDifficulty = e.target.value; });
document.getElementById('crLanguageSelect').addEventListener('change', (e) => { crSelectedLanguage = e.target.value; });
document.getElementById('crCountRow').addEventListener('click', (e) => {
  const chip = e.target.closest('.cr-count-chip');
  if (!chip) return;
  document.querySelectorAll('.cr-count-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  crSelectedCount = parseInt(chip.dataset.count, 10);
});

document.getElementById('crStartBtn').addEventListener('click', startRound);

async function startRound() {
  const btn = document.getElementById('crStartBtn');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const data = await apiPost('/api/coding/start', {
      topic: crSelectedTopic || null,
      difficulty: crSelectedDifficulty || null,
      count: crSelectedCount,
    });

    crAttemptId = data.attempt_id;
    crQuestions = data.questions;
    crCurrentIndex = 0;
    crCodeByQuestion = {};
    crSolvedMap = {};
    crStartedAt = Date.now();

    setupEditor();
    showScreen('solve');
    await renderProblem();
    startTimer();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't start the round. Try a different topic/difficulty.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Coding Round →';
  }
}

// ────────────────────────────────────────────
// Timer — total budget across every problem in the round, same model
// as the aptitude test (spend more time on hard ones if you want).
// ────────────────────────────────────────────
function startTimer() {
  crSecondsRemaining = crSecondsPerQuestion * crQuestions.length;
  updateTimerDisplay();
  clearInterval(crTimerInterval);
  crTimerInterval = setInterval(() => {
    crSecondsRemaining--;
    updateTimerDisplay();
    if (crSecondsRemaining <= 0) {
      clearInterval(crTimerInterval);
      showToast("Time's up — finishing your round.", false);
      finishRound();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('crTimer');
  const m = Math.floor(crSecondsRemaining / 60);
  const s = crSecondsRemaining % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', crSecondsRemaining <= 60);
}

// ────────────────────────────────────────────
// Editor
// ────────────────────────────────────────────
function setupEditor() {
  if (crEditor) return;
  const textarea = document.getElementById('crCodeArea');
  crEditor = CodeMirror.fromTextArea(textarea, {
    lineNumbers: true,
    theme: 'dracula',
    mode: CM_MODE[crSelectedLanguage] || 'text/x-csrc',
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    extraKeys: {
      Tab: (cm) => cm.replaceSelection('    ', 'end'),
    },
  });
}

async function loadStarterCode(questionId, language) {
  const data = await apiGet(`/api/coding/questions/${questionId}/starter?language=${language}`);
  return data.starter_code || '';
}

document.getElementById('crEditorLangSelect').addEventListener('change', async (e) => {
  const q = crQuestions[crCurrentIndex];
  const newLang = e.target.value;
  crSelectedLanguage = newLang;
  crEditor.setOption('mode', CM_MODE[newLang] || 'text/plain');

  const cached = crCodeByQuestion[q.id];
  if (cached && cached.language === newLang) {
    crEditor.setValue(cached.code);
    return;
  }
  try {
    const starter = await loadStarterCode(q.id, newLang);
    crEditor.setValue(starter);
    showToast('Switched language — starter code reloaded for this problem.', false);
  } catch (err) {
    console.error(err);
    crEditor.setValue('');
  }
});

document.getElementById('crResetBtn').addEventListener('click', async () => {
  const q = crQuestions[crCurrentIndex];
  if (!window.confirm('Reset this problem back to the starter code? Your current code here will be lost.')) return;
  try {
    const starter = await loadStarterCode(q.id, crSelectedLanguage);
    crEditor.setValue(starter);
  } catch (err) {
    console.error(err);
    showToast("Couldn't reload starter code.", true);
  }
});

// ────────────────────────────────────────────
// Problem panel
// ────────────────────────────────────────────
function saveCurrentCode() {
  const q = crQuestions[crCurrentIndex];
  if (!q || !crEditor) return;
  crCodeByQuestion[q.id] = { language: crSelectedLanguage, code: crEditor.getValue() };
}

async function renderProblem() {
  const q = crQuestions[crCurrentIndex];
  const panel = document.getElementById('crProblemPanel');

  const samplesHtml = (q.sample_test_cases || []).map((tc, i) => `
    <div class="cr-sample-case">
      <div><b>Sample ${i + 1} — Input:</b></div>
      <div class="cr-sample-io">${escapeHtml(tc.input)}</div>
      <div><b>Expected output:</b></div>
      <div class="cr-sample-io">${escapeHtml(tc.expected_output)}</div>
    </div>
  `).join('') || '<div class="cr-hint">No sample cases for this problem.</div>';

  panel.innerHTML = `
    <div class="cr-q-tags">
      <span class="cr-topic-tag">${escapeHtml((q.topic || '').replace(/_/g, ' '))}</span>
      <span class="cr-diff cr-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
    </div>
    <div class="cr-q-prompt">${escapeHtml(q.prompt)}</div>
    ${q.constraints ? `<div class="cr-constraints"><b>Constraints:</b> ${escapeHtml(q.constraints)}</div>` : ''}
    <div class="cr-samples-title">Sample test cases</div>
    ${samplesHtml}
  `;

  // Language select + editor content
  document.getElementById('crEditorLangSelect').value = crSelectedLanguage;
  const cached = crCodeByQuestion[q.id];
  document.getElementById('crResultsWrap').innerHTML = '';
  if (cached) {
    crSelectedLanguage = cached.language;
    document.getElementById('crEditorLangSelect').value = cached.language;
    crEditor.setOption('mode', CM_MODE[cached.language] || 'text/x-csrc');
    crEditor.setValue(cached.code);
  } else {
    crEditor.setOption('mode', CM_MODE[crSelectedLanguage] || 'text/x-csrc');
    try {
      const starter = await loadStarterCode(q.id, crSelectedLanguage);
      crEditor.setValue(starter);
    } catch (err) {
      console.error(err);
      crEditor.setValue('');
    }
  }

  document.getElementById('crProgressText').textContent = `Problem ${crCurrentIndex + 1} of ${crQuestions.length}`;
  document.getElementById('crProgressFill').style.width = `${((crCurrentIndex + 1) / crQuestions.length) * 100}%`;

  document.getElementById('crPrevBtn').disabled = crCurrentIndex === 0;
  const isLast = crCurrentIndex === crQuestions.length - 1;
  document.getElementById('crSkipBtn').style.display = isLast ? 'none' : '';
  document.getElementById('crFinishBtn').style.display = isLast ? '' : 'none';

  if (crSolvedMap[q.id]) renderResultBanner(crSolvedMap[q.id], true);

  setTimeout(() => crEditor.refresh(), 0);
}

document.getElementById('crPrevBtn').addEventListener('click', () => {
  saveCurrentCode();
  crCurrentIndex--;
  renderProblem();
});
document.getElementById('crSkipBtn').addEventListener('click', () => {
  saveCurrentCode();
  crCurrentIndex++;
  renderProblem();
});
document.getElementById('crFinishBtn').addEventListener('click', finishRound);

// ────────────────────────────────────────────
// Run / Submit
// ────────────────────────────────────────────
function renderCaseResults(results, { hideUnsolved } = {}) {
  return results.map((r, i) => {
    const label = r.is_sample ? `Sample ${i + 1}` : `Hidden case ${i + 1}`;
    const cls = r.passed ? 'pass' : 'fail';
    const icon = r.passed ? '✅' : '❌';
    let detail = '';
    if (r.is_sample) {
      detail = `
        <div class="cr-case-detail"><b>Input:</b>\n${escapeHtml(r.input || '')}
<b>Expected:</b>\n${escapeHtml(r.expected_output || '')}
<b>Your output:</b>\n${escapeHtml(r.actual_output || '(no output)')}</div>
      `;
    } else if (!r.passed) {
      detail = `<div class="cr-case-detail"><b>Your output:</b>\n${escapeHtml(r.actual_output || '(no output)')}</div>`;
    }
    if (r.error) {
      detail += `<div class="cr-case-detail">⚠️ ${escapeHtml(r.error)}</div>`;
    }
    return `
      <div>
        <div class="cr-case-row ${cls}">
          <span>${icon} ${label}</span>
          <span>${r.passed ? 'Passed' : 'Failed'}</span>
        </div>
        ${detail}
      </div>
    `;
  }).join('');
}

function renderResultBanner(summary, quiet) {
  const wrap = document.getElementById('crResultsWrap');
  const allPassed = summary.is_solved;
  const banner = `
    <div class="cr-result-banner ${allPassed ? 'pass' : 'fail'}">
      ${allPassed ? '✅ All test cases passed!' : `${summary.passed_count}/${summary.total_count} test cases passed`}
    </div>
  `;
  if (quiet) {
    wrap.innerHTML = banner;
    return;
  }
  const compileHtml = summary.compile_error ? `<div class="cr-compile-error">${escapeHtml(summary.compile_error)}</div>` : '';
  wrap.innerHTML = banner + compileHtml + renderCaseResults(summary.results || []);
}

document.getElementById('crRunBtn').addEventListener('click', async () => {
  if (crBusy) return;
  crBusy = true;
  const btn = document.getElementById('crRunBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  const q = crQuestions[crCurrentIndex];
  const wrap = document.getElementById('crResultsWrap');
  wrap.innerHTML = '<div class="cr-hint" style="padding:1rem 0;">Compiling and running against sample cases…</div>';

  try {
    const result = await apiPost(`/api/coding/questions/${q.id}/run`, {
      language: crSelectedLanguage,
      source_code: crEditor.getValue(),
    });
    const compileHtml = result.compile_error ? `<div class="cr-compile-error">${escapeHtml(result.compile_error)}</div>` : '';
    const banner = `<div class="cr-result-banner ${result.passed_count === result.total_count ? 'pass' : 'fail'}">${result.passed_count}/${result.total_count} sample case${result.total_count === 1 ? '' : 's'} passed</div>`;
    wrap.innerHTML = banner + compileHtml + renderCaseResults(result.results || []);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '';
    showToast(err.message || "Couldn't run your code. Please try again.", true);
  } finally {
    crBusy = false;
    btn.disabled = false;
    btn.textContent = '▶ Run';
  }
});

document.getElementById('crSubmitBtn').addEventListener('click', async () => {
  if (crBusy) return;
  crBusy = true;
  const btn = document.getElementById('crSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Grading…';

  const q = crQuestions[crCurrentIndex];
  const wrap = document.getElementById('crResultsWrap');
  wrap.innerHTML = '<div class="cr-hint" style="padding:1rem 0;">Compiling and grading against every test case…</div>';

  try {
    const result = await apiPost(`/api/coding/questions/${q.id}/submit`, {
      language: crSelectedLanguage,
      source_code: crEditor.getValue(),
      attempt_id: crAttemptId,
      time_taken_seconds: Math.round((Date.now() - crStartedAt) / 1000),
    });
    crSolvedMap[q.id] = result;
    renderResultBanner(result, false);
    document.getElementById('crResultsWrap').innerHTML += renderCaseResults(result.results || []).length
      ? '' : '';
    showToast(result.is_solved ? '✅ Solved!' : `${result.passed_count}/${result.total_count} test cases passed.`, !result.is_solved);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '';
    showToast(err.message || "Couldn't submit your code. Please try again.", true);
  } finally {
    crBusy = false;
    btn.disabled = false;
    btn.textContent = 'Submit ✓';
  }
});

// ────────────────────────────────────────────
// Finish round → results screen
// ────────────────────────────────────────────
async function finishRound() {
  if (crBusy) return;
  crBusy = true;
  saveCurrentCode();
  clearInterval(crTimerInterval);
  showScreen('loading');

  try {
    const result = await apiPost(`/api/coding/${crAttemptId}/finish`, {
      time_taken_seconds: Math.round((Date.now() - crStartedAt) / 1000),
    });
    renderResults(result);
    showScreen('results');
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't finish the round. Please try again.", true);
    showScreen('solve');
  } finally {
    crBusy = false;
  }
}

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
  const wrap = document.getElementById('crResultsScreen');
  const color = scoreColor(result.score_percent);

  const reviewHtml = result.questions.map((q, i) => `
    <div class="cr-review-card">
      <div class="cr-q-tags">
        <span class="cr-topic-tag">${escapeHtml((q.topic || '').replace(/_/g, ' '))}</span>
        <span class="cr-diff cr-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
        <span class="cr-diff" style="background:${q.is_solved ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color:${q.is_solved ? 'var(--hv-success)' : 'var(--hv-error-light)'}">
          ${q.attempted ? (q.is_solved ? '✅ Solved' : `❌ ${q.passed_count}/${q.total_count} passed`) : '— Not attempted'}
        </span>
      </div>
      <div class="cr-q-prompt" style="font-size:1.02rem;">Q${i + 1}. ${escapeHtml(q.prompt)}</div>
      ${q.attempted ? `
        <div class="cr-hint" style="text-align:left; margin-top:0.5rem;">Language: ${escapeHtml(q.language)}</div>
        <pre class="cr-case-detail">${escapeHtml(q.source_code || '')}</pre>
      ` : ''}
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="cr-results-summary">
      <div class="cr-score-ring" style="color:${color}">${result.score_percent}%</div>
      <div class="cr-score-sub">${result.solved_count} of ${result.total_questions} problems fully solved</div>
      <div class="cr-stats-row">
        <div class="cr-stat-chip">
          <div class="cr-stat-chip-value" style="color:${color}">${result.solved_count}/${result.total_questions}</div>
          <div class="cr-stat-chip-label">Solved</div>
        </div>
        <div class="cr-stat-chip">
          <div class="cr-stat-chip-value" style="color:#818cf8">${formatDuration(result.time_taken_seconds)}</div>
          <div class="cr-stat-chip-label">Time Taken</div>
        </div>
        <div class="cr-stat-chip">
          <div class="cr-stat-chip-value" style="color:#ec4899">${escapeHtml(result.difficulty || 'Mixed')}</div>
          <div class="cr-stat-chip-label">Difficulty</div>
        </div>
      </div>
      <div class="cr-results-actions">
        <button class="secondary-btn" onclick="window.location.href='/history'">View in My Reports</button>
        <button class="start-btn" onclick="resetToSetup()">Start Another Round</button>
      </div>
    </div>
    <div class="cr-review-title">📋 Problem Review</div>
    ${reviewHtml}
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetToSetup() {
  crAttemptId = null;
  crQuestions = [];
  crCodeByQuestion = {};
  crSolvedMap = {};
  crCurrentIndex = 0;
  showScreen('setup');
}

// ────────────────────────────────────────────
// Init
// ────────────────────────────────────────────
(async function init() {
  await loadLanguages();
  loadTopicsForSetup();
})();