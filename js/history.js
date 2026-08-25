if (!authToken) window.location.href = '/auth';

    // Escapes user- or AI-generated text before it's interpolated into
    // innerHTML — needed anywhere a candidate's own answers, a custom-typed
    // role, or LLM-generated feedback text is rendered as HTML.
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str ?? '';
      return div.innerHTML;
    }

    function formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }

    function getScoreColor(score) {
      if (score == null) return 'rgba(255,255,255,0.3)';
      if (score >= 8) return '#22c55e';
      if (score >= 6) return '#f59e0b';
      return '#ef4444';
    }

    function getRecColor(rec) {
      if (!rec) return '#6366f1';
      if (rec.includes('Strong')) return '#22c55e';
      if (rec === 'Hire') return '#6366f1';
      if (rec === 'Borderline') return '#f59e0b';
      return '#ef4444';
    }

    function renderFeedback(feedback) {
      if (!feedback) return `<div class="feedback-section"><div class="no-qa">No feedback available for this session.</div></div>`;

      const recColor = getRecColor(feedback.hiring_recommendation);
      const strengths = (feedback.strengths || []).map(s =>
        `<div class="strength-item">✅ ${escapeHtml(s)}</div>`).join('');
      const improve = (feedback.areas_to_improve || []).map(a =>
        `<div class="improve-item">📈 ${escapeHtml(a)}</div>`).join('');

      return `
        <div class="feedback-section">
          <div class="feedback-title">📊 Feedback Report</div>
          <div class="scores-row">
            <div class="score-chip">
              <div class="score-chip-value" style="color:${getScoreColor(feedback.overall_score)}">${feedback.overall_score ?? '—'}/10</div>
              <div class="score-chip-label">Overall</div>
            </div>
            <div class="score-chip">
              <div class="score-chip-value" style="color:#818cf8">${feedback.technical_score ?? '—'}/10</div>
              <div class="score-chip-label">Technical</div>
            </div>
            <div class="score-chip">
              <div class="score-chip-value" style="color:#ec4899">${feedback.soft_skills_score ?? '—'}/10</div>
              <div class="score-chip-label">Soft Skills</div>
            </div>
          </div>
          <div class="rec-badge" style="background:${recColor}22;border:1px solid ${recColor};color:${recColor}">
            ${feedback.hiring_recommendation || 'Pending'}
          </div>
          ${feedback.personal_note ? `
            <div class="personal-note-box">
              <div class="personal-note-avatar">A</div>
              <div>
                <div style="font-size:0.75rem;font-weight:700;color:rgba(255,255,255,0.6);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.5px">A note from Arjun</div>
                <div class="personal-note-text">"${escapeHtml(feedback.personal_note)}"</div>
              </div>
            </div>` : ''}
          <div class="feedback-summary">${escapeHtml(feedback.summary)}</div>
          ${strengths || improve ? `
            <div class="strengths-improve-grid">
              <div>
                <div style="font-size:0.78rem;font-weight:700;color:#22c55e;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px">Strengths</div>
                ${strengths}
              </div>
              <div>
                <div style="font-size:0.78rem;font-weight:700;color:#f87171;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px">Areas to Improve</div>
                ${improve}
              </div>
            </div>` : ''}
          ${feedback.next_steps ? `
            <div>
              <div style="font-size:0.78rem;font-weight:700;color:#818cf8;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px">🎯 Next Steps</div>
              <div class="next-steps-box">${escapeHtml(feedback.next_steps)}</div>
            </div>` : ''}
          ${renderIntegrityReport(feedback.integrity_flags)}
        </div>`;
    }

    function renderIntegrityReport(ir) {
      if (!ir) return '';
      const unmonitored = !!ir.camera_unavailable;
      const color = unmonitored ? '#f59e0b'
        : ir.verdict === 'Clean' ? '#22c55e'
        : ir.verdict === 'Minor Concerns' ? '#f59e0b' : '#ef4444';
      return `
        <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:1.5rem;margin-top:1.25rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem">
            <div style="font-weight:700;color:#f87171">🔍 Integrity Report</div>
            <div style="padding:0.35rem 1rem;background:${color}22;border:1px solid ${color};border-radius:20px;color:${color};font-weight:700;font-size:0.85rem">
              ${escapeHtml(ir.verdict || '—')}${ir.integrity_score != null ? ` — ${ir.integrity_score}/100` : ''}
            </div>
          </div>
          ${unmonitored ? `
            <div style="color:rgba(255,255,255,0.6);font-size:0.85rem;line-height:1.6">Camera/mic access wasn't available during this session, so video-based checks (face presence, multi-face detection) could not run.</div>
          ` : `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;font-size:0.85rem">
              <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:0.75rem;text-align:center">
                <div style="font-size:1.4rem;font-weight:800;color:${(ir.tab_switches || 0) > 0 ? '#f87171' : '#22c55e'}">${ir.tab_switches ?? 0}</div>
                <div style="color:rgba(255,255,255,0.5);font-size:0.78rem">Tab Switches</div>
              </div>
              <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:0.75rem;text-align:center">
                <div style="font-size:1.4rem;font-weight:800;color:${(ir.window_switches || 0) > 2 ? '#f87171' : '#22c55e'}">${ir.window_switches ?? 0}</div>
                <div style="color:rgba(255,255,255,0.5);font-size:0.78rem">Window Switches</div>
              </div>
            </div>
          `}
        </div>`;
    }

    function getSectorBadge(i) {
      if (i.sector === 'government') {
        const label = i.government_domain ? `🏛️ ${escapeHtml(i.government_domain)}` : '🏛️ Government';
        return `<span class="sector-badge sector-government">${label}</span>`;
      }
      return `<span class="sector-badge sector-private">💼 Private</span>`;
    }

    function getRoundBadge(i) {
      if (i.sector !== 'private' || !i.interview_round || i.interview_round === 'mixed') return '';
      const map = {
        technical: { icon: '🖥️', label: 'Technical Round' },
        hr: { icon: '🗣️', label: 'HR Round' }
      };
      const r = map[i.interview_round];
      if (!r) return '';
      return `<span class="sector-badge" style="background:rgba(129,140,248,0.15);color:#818cf8;border:1px solid rgba(129,140,248,0.3)">${r.icon} ${r.label}</span>`;
    }

    function renderGovInfo(i) {
      if (i.sector !== 'government') return '';
      return `
        <div class="gov-info-section" style="padding:1.5rem 1.5rem 0 1.5rem">
          <div class="gov-info-box">
            <div class="gov-info-label">🏛️ Government Role</div>
            <div>${escapeHtml(i.government_role) || '—'}${i.government_domain ? ` · ${escapeHtml(i.government_domain)}` : ''}</div>
            ${i.candidate_summary ? `<div class="gov-info-label" style="margin-top:0.75rem">Candidate Summary</div><div>${escapeHtml(i.candidate_summary)}</div>` : ''}
          </div>
        </div>`;
    }

    function renderQA(questions) {
      if (!questions || questions.length === 0) {
        return `<div class="qa-section"><div class="no-qa">No questions recorded for this session.</div></div>`;
      }
      const items = questions.map((q, i) => `
        <div class="qa-item">
          <div class="qa-question">Q${i + 1}. ${escapeHtml(q.question_text)}</div>
          <div class="qa-answer ${q.answer_text === '[Skipped]' ? 'qa-skipped' : ''}">
            ${q.answer_text === '[Skipped]' ? '⏭️ Skipped' : escapeHtml(q.answer_text) || '—'}
          </div>
        </div>`).join('');
      return `<div class="qa-section"><div class="feedback-title">💬 Questions & Answers</div>${items}</div>`;
    }

    function toggleCard(id) {
      const body = document.getElementById(`body-${id}`);
      const icon = document.getElementById(`icon-${id}`);
      body.classList.toggle('open');
      icon.classList.toggle('open');
    }

    // If the user landed here from a "recent interview" click on the
    // dashboard (/history?id=123), open that specific card's details
    // and scroll it into view instead of just showing the plain list.
    function openInterviewFromQuery() {
      const id = new URLSearchParams(window.location.search).get('id');
      if (!id) return;

      const card = document.getElementById(`card-${id}`);
      if (!card) return; // e.g. a stale/failed session that got filtered out

      const body = document.getElementById(`body-${id}`);
      const icon = document.getElementById(`icon-${id}`);
      if (body && !body.classList.contains('open')) {
        body.classList.add('open');
        if (icon) icon.classList.add('open');
      }

      card.classList.add('history-card-highlight');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => card.classList.remove('history-card-highlight'), 2500);
    }

    function renderHistory(interviews) {
      const container = document.getElementById('historyContainer');

      const relevant = interviews.filter(i =>
        i.questions.length > 0 || i.feedback ||
        i.status === 'completed' || i.status === 'cheating_terminated' || i.status === 'failed'
      );

      if (relevant.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.5rem">No interviews yet</div>
            <div style="font-size:0.9rem">Complete an interview to see your history here</div>
          </div>`;
        return;
      }

      const nonExpandable = i => i.status === 'cheating_terminated' || i.status === 'failed';

      container.innerHTML = `<div class="history-list">${relevant.map(i => `
        <div class="history-card" id="card-${i.id}">
         <div class="history-card-header" ${!nonExpandable(i) ? `onclick="toggleCard(${i.id})"` : ''}>
            <div>
              <div class="history-role">${escapeHtml(i.role)}</div>
              <div class="history-date">📅 ${formatDate(i.started_at)}</div>
            </div>
            <div class="history-meta">
              ${getSectorBadge(i)}
              ${getRoundBadge(i)}
              <div class="history-score" style="color:${getScoreColor(i.overall_score)}">
                ${i.overall_score != null ? `${i.overall_score}/10` : '—'}
              </div>
              <span class="status-badge status-${i.status}">
                ${i.status === 'completed' ? '✅ Completed' 
                : i.status === 'cheating_terminated' ? '🚨 Terminated'
                : i.status === 'failed' ? '⚠️ Failed — not counted'
                : '🔄 In Progress'}
              </span>
              ${!nonExpandable(i) ? `<span class="expand-icon" id="icon-${i.id}">▼</span>` : ''}
            </div>
          </div>
          <div class="history-card-body" id="body-${i.id}">
            ${i.status === 'cheating_terminated' 
              ? `<div style="padding:1.5rem;background:rgba(239,68,68,0.06);border-top:1px solid rgba(239,68,68,0.2)">
                  <div style="color:#f87171;font-weight:700;font-size:1rem;margin-bottom:0.5rem">🚨 Interview Terminated Due to Integrity Violation</div>
                  <div style="color:rgba(255,255,255,0.6);font-size:0.9rem;line-height:1.6">This interview was terminated because cheating signals were detected (tab switching or multiple faces on camera). No score or feedback is available for this session.</div>
                </div>`
              : i.status === 'failed'
              ? `<div style="padding:1.5rem;background:rgba(148,163,184,0.06);border-top:1px solid rgba(148,163,184,0.2)">
                  <div style="color:#94a3b8;font-weight:700;font-size:1rem;margin-bottom:0.5rem">⚠️ Interview Failed</div>
                  <div style="color:rgba(255,255,255,0.6);font-size:0.9rem;line-height:1.6">${i.failure_reason ? escapeHtml(i.failure_reason) : 'This session could not be completed due to a technical issue.'}</div>
                  <div style="color:rgba(255,255,255,0.6);font-size:0.82rem;margin-top:0.75rem">This attempt was not your fault — it has NOT been counted against your free interviews.</div>
                </div>`
              : `${renderGovInfo(i)}${renderFeedback(i.feedback)}${renderQA(i.questions)}`
            }
          </div>
        </div>`).join('')}
      </div>`;
    }

    async function loadHistory() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/history`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/auth'; return; }
          throw new Error('Failed to load history');
        }

        const data = await res.json();
        renderHistory(data);
        openInterviewFromQuery();

      } catch (err) {
        console.error('History error:', err);
        document.getElementById('historyContainer').innerHTML =
          '<div style="color:#f87171;padding:1rem">Could not load history. Is the backend running?</div>';
      }
    }

    // ────────────────────────────────────────────
    // Aptitude Test reports tab
    // Talks to /api/aptitude/attempts* (routes/aptitude.py). Summaries
    // load once up front; full per-question review is fetched lazily
    // the first time a card is expanded, then cached in aptAttemptCache.
    // ────────────────────────────────────────────
    let aptReportsLoaded = false;
    const aptAttemptCache = {}; // attempt id -> full review payload

    function switchReportsTab(tab) {
      document.querySelectorAll('.reports-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      document.getElementById('historyContainer').style.display = tab === 'interviews' ? '' : 'none';
      document.getElementById('aptitudeReportsContainer').style.display = tab === 'aptitude' ? '' : 'none';
      if (tab === 'aptitude' && !aptReportsLoaded) loadAptitudeReports();
    }

    document.getElementById('reportsTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.reports-tab');
      if (!btn) return;
      switchReportsTab(btn.dataset.tab);
    });

    function aptScoreColor(pct) {
      if (pct == null) return 'rgba(255,255,255,0.3)';
      if (pct >= 70) return '#22c55e';
      if (pct >= 40) return '#f59e0b';
      return '#ef4444';
    }

    function formatAptDuration(seconds) {
      if (seconds == null) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    function renderAptitudeReports(attempts) {
      const container = document.getElementById('aptitudeReportsContainer');

      if (attempts.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🧮</div>
            <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.5rem">No aptitude tests yet</div>
            <div style="font-size:0.9rem">Take one from the Aptitude Test page to see your results here</div>
            <button class="back-btn" style="margin-top:1.25rem;background:rgba(99,102,241,0.2);border-color:rgba(99,102,241,0.4);color:#818cf8" onclick="window.location.href='/aptitude'">Take an Aptitude Test</button>
          </div>`;
        return;
      }

      container.innerHTML = `<div class="history-list">${attempts.map(a => `
        <div class="history-card" id="apt-card-${a.id}">
          <div class="history-card-header" onclick="toggleAptCard(${a.id})">
            <div>
              <div class="history-role">${escapeHtml((a.topic || 'Mixed topics').replace(/_/g, ' '))} ${a.difficulty ? `· ${escapeHtml(a.difficulty)}` : '· mixed'}</div>
              <div class="history-date">📅 ${formatDate(a.started_at)} · ⏱️ ${formatAptDuration(a.time_taken_seconds)}</div>
            </div>
            <div class="history-meta">
              <div class="apt-score-badge" style="color:${aptScoreColor(a.score_percent)}">${a.score_percent}%</div>
              <span class="status-badge status-completed">${a.correct_count}/${a.total_questions} correct</span>
              <span class="expand-icon" id="apt-icon-${a.id}">▼</span>
            </div>
          </div>
          <div class="history-card-body" id="apt-body-${a.id}">
            <div class="qa-section" id="apt-review-${a.id}"><div class="no-qa">Loading review…</div></div>
          </div>
        </div>`).join('')}</div>`;
    }

    async function toggleAptCard(id) {
      const body = document.getElementById(`apt-body-${id}`);
      const icon = document.getElementById(`apt-icon-${id}`);
      body.classList.toggle('open');
      icon.classList.toggle('open');
      if (!body.classList.contains('open')) return;

      if (!aptAttemptCache[id]) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/aptitude/attempts/${id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (!res.ok) throw new Error('Failed to load review');
          aptAttemptCache[id] = await res.json();
        } catch (err) {
          console.error('Aptitude review error:', err);
          document.getElementById(`apt-review-${id}`).innerHTML =
            '<div style="color:#f87171;padding:1rem">Could not load this review.</div>';
          return;
        }
      }

      renderAptReview(id, aptAttemptCache[id]);
    }

    function renderAptReview(id, attempt) {
      const wrap = document.getElementById(`apt-review-${id}`);
      wrap.innerHTML = attempt.questions.map((q, i) => {
        const optionsHtml = q.options.map((opt, idx) => {
          let cls = 'apt-review-option';
          if (idx === q.correct_index) cls += ' correct';
          else if (idx === q.selected_index) cls += ' incorrect';
          return `<div class="${cls}">${escapeHtml(opt)}</div>`;
        }).join('');
        return `
          <div class="apt-review-q">
            <div class="apt-review-prompt">Q${i + 1}. ${escapeHtml(q.prompt)} ${q.is_correct ? '✅' : '❌'}</div>
            ${optionsHtml}
            ${q.explanation ? `<div class="apt-review-explanation">${escapeHtml(q.explanation)}</div>` : ''}
          </div>`;
      }).join('');
    }

    async function loadAptitudeReports() {
      aptReportsLoaded = true;
      try {
        const res = await fetch(`${BACKEND_URL}/api/aptitude/attempts`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/auth'; return; }
          throw new Error('Failed to load aptitude reports');
        }
        const data = await res.json();
        renderAptitudeReports(data.attempts || []);
      } catch (err) {
        console.error('Aptitude reports error:', err);
        aptReportsLoaded = false;
        document.getElementById('aptitudeReportsContainer').innerHTML =
          '<div style="color:#f87171;padding:1rem">Could not load aptitude reports. Is the backend running?</div>';
      }
    }

    loadHistory();