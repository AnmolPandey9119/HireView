/* ════════════════════════════════════════════════
   HireView — Question Bank page
   Talks to /api/questions* (routes/questions.py). Aptitude answers are
   never graded client-side — list/detail responses never include
   correct_index, so this file always POSTs to /questions/{id}/answer
   and trusts whatever the backend says. Coding/interview questions
   are browse-only here (no in-browser compiler yet — that's a
   separate phase); this page shows the problem, starter code and
   sample cases so a candidate can still practice by hand.
   ════════════════════════════════════════════════ */

   if (!authToken) window.location.href = '/auth';

   let qbCategory = 'aptitude';
   let qbDifficulty = '';
   let qbTopic = '';
   let qbTopicsCache = {}; // category -> {topic: {easy,medium,hard}}
   let qbQuestionsCache = {}; // `${category}|${topic}|${difficulty}` -> questions[]
   
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
     if (!res.ok) throw new Error(`Request failed (${res.status})`);
     return res.json();
   }
   
   const CATEGORY_ICON = { aptitude: '🧮', coding: '💻', interview: '🗣️' };
   
   // ────────────────────────────────────────────
   // Tabs
   // ────────────────────────────────────────────
   document.getElementById('qbTabs').addEventListener('click', (e) => {
     const btn = e.target.closest('.qb-tab');
     if (!btn) return;
     document.querySelectorAll('.qb-tab').forEach(t => t.classList.remove('active'));
     btn.classList.add('active');
     qbCategory = btn.dataset.category;
     qbTopic = '';
     loadTopics();
     loadQuestions();
   });
   
   document.getElementById('difficultyFilter').addEventListener('change', (e) => {
     qbDifficulty = e.target.value;
     loadQuestions();
   });
   
   // ────────────────────────────────────────────
   // Topics
   // ────────────────────────────────────────────
   async function loadTopics() {
     const wrap = document.getElementById('qbTopics');
     wrap.innerHTML = '';
     try {
       if (!qbTopicsCache[qbCategory]) {
         const data = await apiGet(`/api/questions/topics?category=${qbCategory}`);
         qbTopicsCache[qbCategory] = data.topics || {};
       }
       const topics = qbTopicsCache[qbCategory];
       const allChip = document.createElement('button');
       allChip.className = 'qb-topic-chip' + (qbTopic === '' ? ' active' : '');
       allChip.textContent = 'All topics';
       allChip.onclick = () => { qbTopic = ''; loadTopics(); loadQuestions(); };
       wrap.appendChild(allChip);
   
       Object.keys(topics).sort().forEach(topic => {
         const counts = topics[topic];
         const total = (counts.easy || 0) + (counts.medium || 0) + (counts.hard || 0);
         const chip = document.createElement('button');
         chip.className = 'qb-topic-chip' + (qbTopic === topic ? ' active' : '');
         chip.textContent = `${topic.replace(/_/g, ' ')} (${total})`;
         chip.onclick = () => { qbTopic = topic; loadTopics(); loadQuestions(); };
         wrap.appendChild(chip);
       });
     } catch (err) {
       console.error(err);
     }
   }
   
   // ────────────────────────────────────────────
   // Question grid
   // ────────────────────────────────────────────
   async function loadQuestions() {
     const gridWrap = document.getElementById('qbGridWrap');
     const statPill = document.getElementById('qbStatPill');
     gridWrap.innerHTML = '<div class="qb-loading">Loading questions…</div>';
   
     try {
       const params = new URLSearchParams({ category: qbCategory, limit: '100' });
       if (qbTopic) params.set('topic', qbTopic);
       if (qbDifficulty) params.set('difficulty', qbDifficulty);
       const data = await apiGet(`/api/questions?${params.toString()}`);
       const questions = data.questions || [];
       statPill.textContent = `${data.count} question${data.count === 1 ? '' : 's'}`;
   
       if (questions.length === 0) {
         gridWrap.innerHTML = '<div class="qb-empty">No questions match this filter yet. Try a different topic or difficulty.</div>';
         return;
       }
   
       const grid = document.createElement('div');
       grid.className = 'qb-grid';
       questions.forEach(q => grid.appendChild(buildQuestionCard(q)));
       gridWrap.innerHTML = '';
       gridWrap.appendChild(grid);
     } catch (err) {
       console.error(err);
       gridWrap.innerHTML = '<div class="qb-empty">Couldn\'t load questions right now. Please try again.</div>';
     }
   }
   
   function buildQuestionCard(q) {
     const card = document.createElement('div');
     card.className = 'qb-card';
     card.innerHTML = `
       <div class="qb-card-top">
         <span class="qb-topic-tag">${escapeHtml(q.topic.replace(/_/g, ' '))}</span>
         <span class="qb-diff qb-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
       </div>
       <div class="qb-card-prompt">${escapeHtml(q.prompt)}</div>
       <div class="qb-card-cta">${CATEGORY_ICON[qbCategory] || ''} Click to practice →</div>
     `;
     card.onclick = () => openQuestion(q.id);
     return card;
   }
   
   // ────────────────────────────────────────────
   // Practice modal
   // ────────────────────────────────────────────
   async function openQuestion(id) {
     try {
       const q = await apiGet(`/api/questions/${id}`);
       if (q.category === 'aptitude') renderAptitudeModal(q);
       else if (q.category === 'coding') await renderCodingModal(q);
       else renderInterviewModal(q);
       document.getElementById('qbModalOverlay').classList.add('open');
     } catch (err) {
       console.error(err);
       showToast("Couldn't open this question. Please try again.", true);
     }
   }
   
   function closeQbModal() {
     document.getElementById('qbModalOverlay').classList.remove('open');
     qbCodeEditor = null;
     qbEditorQuestion = null;
   }
   
   document.getElementById('qbModalOverlay').addEventListener('click', (e) => {
     if (e.target.id === 'qbModalOverlay') closeQbModal();
   });
   
   function modalShell(bodyHtml) {
     return `
       <div class="qb-modal-head">
         <div><span class="qb-topic-tag">${''}</span></div>
         <button class="qb-modal-close" onclick="closeQbModal()">✕</button>
       </div>
       ${bodyHtml}
     `;
   }
   
   function renderAptitudeModal(q) {
     const modal = document.getElementById('qbModal');
     const optionsHtml = q.options.map((opt, i) => `
       <button class="qb-option" data-index="${i}" onclick="selectAptitudeOption(${q.id}, ${i})">${escapeHtml(opt)}</button>
     `).join('');
   
     modal.innerHTML = `
       <div class="qb-modal-head">
         <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
           <span class="qb-topic-tag">${escapeHtml(q.topic.replace(/_/g, ' '))}</span>
           <span class="qb-diff qb-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
         </div>
         <button class="qb-modal-close" onclick="closeQbModal()">✕</button>
       </div>
       <div class="qb-modal-prompt">${escapeHtml(q.prompt)}</div>
       <div class="qb-options" id="qbOptionsWrap">${optionsHtml}</div>
       <div id="qbResultWrap"></div>
       <div class="qb-modal-actions">
         <button class="secondary-btn" onclick="closeQbModal()">Close</button>
       </div>
     `;
   }
   
   let qbAnswering = false;
   async function selectAptitudeOption(questionId, index) {
     if (qbAnswering) return;
     qbAnswering = true;
   
     const buttons = document.querySelectorAll('#qbOptionsWrap .qb-option');
     buttons.forEach(b => b.classList.add('disabled'));
     buttons[index].classList.add('selected');
   
     try {
       const result = await apiPost(`/api/questions/${questionId}/answer`, { selected_index: index });
       buttons.forEach(b => b.onclick = null);
       buttons[index].classList.remove('selected');
       buttons[index].classList.add(result.is_correct ? 'correct' : 'incorrect');
       if (!result.is_correct && result.correct_index != null) {
         buttons[result.correct_index].classList.add('correct');
       }
   
       const resultWrap = document.getElementById('qbResultWrap');
       resultWrap.innerHTML = `
         <div class="qb-result-banner ${result.is_correct ? 'correct' : 'incorrect'}">
           ${result.is_correct ? '✅ Correct!' : '❌ Not quite.'}
           <div class="qb-explanation">${escapeHtml(result.explanation || '')}</div>
         </div>
       `;
     } catch (err) {
       console.error(err);
       showToast("Couldn't check your answer. Please try again.", true);
       buttons.forEach(b => b.classList.remove('disabled'));
     } finally {
       qbAnswering = false;
     }
   }
   
   // ────────────────────────────────────────────
   // Coding practice — in-modal compiler
   // Talks to /api/coding/questions/{id}/run and /submit (routes/coding.py),
   // the same Piston-backed grading engine the full Coding Round page uses.
   // This is the ungraded, one-off "practice a single problem" flow —
   // no attempt_id is sent, so nothing here counts toward a Coding Round.
   // ────────────────────────────────────────────
   const QB_CM_MODE = {
     c: 'text/x-csrc', cpp: 'text/x-c++src', java: 'text/x-java',
     python: 'python', javascript: 'javascript',
   };
   let qbLanguagesCache = null;
   let qbCodeEditor = null;
   let qbEditorQuestion = null;
   let qbEditorBusy = false;

   async function qbLoadLanguages() {
     if (qbLanguagesCache) return qbLanguagesCache;
     try {
       const data = await apiGet('/api/coding/languages');
       qbLanguagesCache = data.languages || [];
     } catch (err) {
       console.error(err);
       qbLanguagesCache = [{ id: 'c', label: 'C (GCC)', monaco_language: 'c' }];
     }
     return qbLanguagesCache;
   }

   function qbRenderCaseResults(results) {
     return (results || []).map((r, i) => {
       const label = r.is_sample ? `Sample ${i + 1}` : `Hidden case ${i + 1}`;
       const cls = r.passed ? 'pass' : 'fail';
       const icon = r.passed ? '✅' : '❌';
       let detail = '';
       if (r.is_sample) {
         detail = `<div class="qb-case-detail"><b>Input:</b>\n${escapeHtml(r.input || '')}
<b>Expected:</b>\n${escapeHtml(r.expected_output || '')}
<b>Your output:</b>\n${escapeHtml(r.actual_output || '(no output)')}</div>`;
       } else if (!r.passed) {
         detail = `<div class="qb-case-detail"><b>Your output:</b>\n${escapeHtml(r.actual_output || '(no output)')}</div>`;
       }
       if (r.error) detail += `<div class="qb-case-detail">⚠️ ${escapeHtml(r.error)}</div>`;
       return `<div><div class="qb-case-row ${cls}"><span>${icon} ${label}</span><span>${r.passed ? 'Passed' : 'Failed'}</span></div>${detail}</div>`;
     }).join('');
   }

   async function renderCodingModal(q) {
     const modal = document.getElementById('qbModal');
     const samplesHtml = (q.sample_test_cases || []).map((tc, i) => `
       <div class="qb-sample-case">
         <div><b>Sample ${i + 1} — Input:</b></div>
         <div style="font-family:'Courier New',monospace; margin:0.25rem 0 0.5rem; white-space:pre-wrap;">${escapeHtml(tc.input)}</div>
         <div><b>Expected output:</b></div>
         <div style="font-family:'Courier New',monospace; margin-top:0.25rem; white-space:pre-wrap;">${escapeHtml(tc.expected_output)}</div>
       </div>
     `).join('') || '<div class="qb-coding-note">No sample cases for this problem.</div>';

     const languages = await qbLoadLanguages();
     const langOptionsHtml = languages.map(l => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('');

     modal.innerHTML = `
       <div class="qb-modal-head">
         <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
           <span class="qb-topic-tag">${escapeHtml(q.topic.replace(/_/g, ' '))}</span>
           <span class="qb-diff qb-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
         </div>
         <button class="qb-modal-close" onclick="closeQbModal()">✕</button>
       </div>
       <div class="qb-modal-prompt">${escapeHtml(q.prompt)}</div>
       ${q.constraints ? `<div class="qb-constraints"><b>Constraints:</b> ${escapeHtml(q.constraints)}</div>` : ''}
       <div style="font-weight:700; font-size:0.85rem; color:rgba(255,255,255,0.6); margin-bottom:0.6rem;">Sample test cases</div>
       ${samplesHtml}
       <div class="qb-editor-top">
         <select class="qb-lang-select" id="qbLangSelect">${langOptionsHtml}</select>
         <div class="qb-editor-actions">
           <button class="qb-btn" id="qbResetBtn">↺ Reset</button>
           <button class="qb-btn" id="qbRunBtn">▶ Run</button>
           <button class="qb-btn submit" id="qbSubmitBtn">Submit ✓</button>
         </div>
       </div>
       <div class="qb-editor-wrap"><textarea id="qbCodeArea"></textarea></div>
       <div id="qbCodeResultWrap"></div>
       <div class="qb-modal-actions">
         <button class="secondary-btn" onclick="closeQbModal()">Close</button>
       </div>
     `;

     qbEditorQuestion = q;
     const textarea = document.getElementById('qbCodeArea');
     const defaultLang = languages[0]?.id || 'c';
     qbCodeEditor = CodeMirror.fromTextArea(textarea, {
       lineNumbers: true,
       theme: 'dracula',
       mode: QB_CM_MODE[defaultLang] || 'text/x-csrc',
       indentUnit: 4,
       tabSize: 4,
       matchBrackets: true,
       extraKeys: { Tab: (cm) => cm.replaceSelection('    ', 'end') },
     });
     qbCodeEditor.setValue(q.starter_code || '');
     setTimeout(() => qbCodeEditor.refresh(), 0);

     document.getElementById('qbLangSelect').addEventListener('change', async (e) => {
       const lang = e.target.value;
       qbCodeEditor.setOption('mode', QB_CM_MODE[lang] || 'text/plain');
       try {
         const data = await apiGet(`/api/coding/questions/${q.id}/starter?language=${lang}`);
         qbCodeEditor.setValue(data.starter_code || '');
       } catch (err) {
         console.error(err);
       }
     });

     document.getElementById('qbResetBtn').addEventListener('click', async () => {
       const lang = document.getElementById('qbLangSelect').value;
       try {
         const data = await apiGet(`/api/coding/questions/${q.id}/starter?language=${lang}`);
         qbCodeEditor.setValue(data.starter_code || '');
       } catch (err) {
         console.error(err);
       }
     });

     document.getElementById('qbRunBtn').addEventListener('click', () => qbRunOrSubmit('run'));
     document.getElementById('qbSubmitBtn').addEventListener('click', () => qbRunOrSubmit('submit'));
   }

   async function qbRunOrSubmit(mode) {
     if (qbEditorBusy || !qbEditorQuestion) return;
     qbEditorBusy = true;
     const btn = document.getElementById(mode === 'run' ? 'qbRunBtn' : 'qbSubmitBtn');
     const originalLabel = btn.textContent;
     btn.disabled = true;
     btn.textContent = mode === 'run' ? 'Running…' : 'Grading…';

     const wrap = document.getElementById('qbCodeResultWrap');
     wrap.innerHTML = `<div class="qb-coding-note">Compiling and ${mode === 'run' ? 'running against sample cases' : 'grading against every test case'}…</div>`;

     const language = document.getElementById('qbLangSelect').value;
     const path = mode === 'run'
       ? `/api/coding/questions/${qbEditorQuestion.id}/run`
       : `/api/coding/questions/${qbEditorQuestion.id}/submit`;

     try {
       const result = await apiPost(path, { language, source_code: qbCodeEditor.getValue() });
       const total = result.total_count;
       const passed = result.passed_count;
       const bannerLabel = mode === 'run'
         ? `${passed}/${total} sample case${total === 1 ? '' : 's'} passed`
         : (result.is_solved ? 'All test cases passed!' : `${passed}/${total} test cases passed`);
       const compileHtml = result.compile_error ? `<div class="qb-compile-error">${escapeHtml(result.compile_error)}</div>` : '';
       wrap.innerHTML = `
         <div class="qb-result-banner-run ${passed === total ? 'pass' : 'fail'}">${passed === total ? '✅ ' : ''}${bannerLabel}</div>
         ${compileHtml}
         ${qbRenderCaseResults(result.results)}
       `;
       if (mode === 'submit') {
         showToast(result.is_solved ? '✅ Solved!' : `${passed}/${total} test cases passed.`, !result.is_solved);
       }
     } catch (err) {
       console.error(err);
       wrap.innerHTML = '';
       showToast(err.message || `Couldn't ${mode} your code. Please try again.`, true);
     } finally {
       qbEditorBusy = false;
       btn.disabled = false;
       btn.textContent = originalLabel;
     }
   }
   
   function renderInterviewModal(q) {
     const modal = document.getElementById('qbModal');
     modal.innerHTML = `
       <div class="qb-modal-head">
         <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
           <span class="qb-topic-tag">${escapeHtml(q.topic.replace(/_/g, ' '))}</span>
           <span class="qb-diff qb-diff-${q.difficulty}">${escapeHtml(q.difficulty)}</span>
         </div>
         <button class="qb-modal-close" onclick="closeQbModal()">✕</button>
       </div>
       <div class="qb-modal-prompt">${escapeHtml(q.prompt)}</div>
       <div class="qb-interview-note">Think out loud — structure your answer, use a real example, and say it the way you would to an interviewer. Want a full mock round instead of a single question? Start an interview from the dashboard and this topic area will come up naturally.</div>
       <div class="qb-modal-actions">
         <button class="secondary-btn" onclick="closeQbModal()">Close</button>
         <button class="start-btn" onclick="window.location.href='/dashboard'">Start a mock interview</button>
       </div>
     `;
   }
   
   // ────────────────────────────────────────────
   // Init
   // ────────────────────────────────────────────
   loadTopics();
   loadQuestions();