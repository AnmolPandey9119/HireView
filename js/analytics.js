/* ════════════════════════════════════════════════
   HireView — Analytics page
   Talks to GET /api/analytics/summary (routes/analytics.py), a single
   read-only aggregation endpoint. This file just renders it — all the
   grading/aggregation math happens server-side, same trust model as
   every other page in the app.
   ════════════════════════════════════════════════ */

   if (!authToken) window.location.href = '/auth';

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
     if (res.status === 401) {
       localStorage.removeItem('hv_token');
       localStorage.removeItem('hv_user');
       window.location.href = '/auth';
       throw new Error('Session expired');
     }
     if (!res.ok) throw new Error(`Request failed (${res.status})`);
     return res.json();
   }
   
   // Shared chart palette — matches the app's CSS custom properties
   // (css/main.css :root) so charts feel native, not bolted-on.
   const CHART_COLORS = {
     primary: '#6366f1', primaryLight: '#818cf8', accent: '#ec4899',
     success: '#22c55e', warning: '#f59e0b', cyan: '#22d3ee',
     gridLine: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.65)'
   };
   Chart.defaults.color = CHART_COLORS.text;
   Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
   
   function formatShortDate(iso) {
     if (!iso) return '';
     return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
   }
   
   function renderStats(o) {
     document.getElementById('statsGrid').innerHTML = `
       <div class="stat-card">
         <div class="stat-icon">🎯</div>
         <div class="stat-value stat-purple">${o.avg_overall_score ?? '—'}${o.avg_overall_score != null ? '/10' : ''}</div>
         <div class="stat-label">Avg Interview Score</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">🧮</div>
         <div class="stat-value stat-cyan">${o.avg_aptitude_score != null ? o.avg_aptitude_score + '%' : '—'}</div>
         <div class="stat-label">Avg Aptitude Score</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">💻</div>
         <div class="stat-value stat-green">${o.avg_coding_score != null ? o.avg_coding_score + '%' : '—'}</div>
         <div class="stat-label">Avg Coding Score</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">🔥</div>
         <div class="stat-value stat-yellow">${o.current_streak_days}</div>
         <div class="stat-label">Day Streak</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">🏅</div>
         <div class="stat-value stat-pink">${o.best_overall_score ?? '—'}${o.best_overall_score != null ? '/10' : ''}</div>
         <div class="stat-label">Best Interview Score</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">📈</div>
         <div class="stat-value stat-purple">${o.percentile != null ? 'Top ' + Math.max(1, 100 - o.percentile) + '%' : '—'}</div>
         <div class="stat-label">Interview Percentile</div>
       </div>
       <div class="stat-card">
         <div class="stat-icon">🏅</div>
         <div class="stat-value stat-yellow">${o.badges_earned_count}/${o.badges_total_count}</div>
         <div class="stat-label">Badges Earned</div>
       </div>`;
   }
   
   function renderBadges(badges) {
     const cards = badges.map(b => `
       <div class="badge-card${b.earned ? ' earned' : ''}" title="${escapeHtml(b.description)}">
         <div class="badge-icon">${b.icon}</div>
         <div class="badge-label">${escapeHtml(b.label)}</div>
         <div class="badge-desc">${escapeHtml(b.description)}</div>
         ${b.earned ? '<div class="badge-tick">✓ Earned</div>' : '<div class="badge-locked">🔒 Locked</div>'}
       </div>`).join('');
     return `
       <div class="chart-card" style="margin-bottom:1.5rem;">
         <div class="chart-card-title">🏆 Trophy Case</div>
         <div class="badge-grid">${cards}</div>
       </div>`;
   }
   
   function renderEmptyState() {
     document.getElementById('analyticsBody').innerHTML = `
       <div class="empty-analytics">
         <div class="empty-analytics-icon">📊</div>
         <div class="empty-analytics-title">No data yet</div>
         <div class="empty-analytics-sub">Take an interview, aptitude test or coding round — your charts show up here automatically.</div>
         <button class="primary-btn" onclick="window.location.href='/dashboard'">Start Practicing →</button>
       </div>`;
   }
   
   function renderBody(data) {
     document.getElementById('analyticsBody').innerHTML = `
       ${renderBadges(data.badges)}
       <div class="analytics-grid">
         <div class="chart-card">
           <div class="chart-card-title">📈 Interview Score Trend</div>
           <div class="chart-wrap"><canvas id="scoreTrendChart"></canvas></div>
         </div>
         <div class="chart-card">
           <div class="chart-card-title">🕸️ Skill Breakdown</div>
           <div class="chart-wrap"><canvas id="skillRadarChart"></canvas></div>
         </div>
       </div>
       <div class="analytics-grid">
         <div class="chart-card">
           <div class="chart-card-title">🧮 Aptitude — Topic-wise Accuracy</div>
           <div class="chart-wrap short"><canvas id="topicBarChart"></canvas></div>
         </div>
         <div class="chart-card">
           <div class="chart-card-title">🧩 Practice Mix</div>
           <div class="chart-wrap short"><canvas id="practiceMixChart"></canvas></div>
         </div>
       </div>
     `;
   
     // ── Score trend (line) ──────────────────────────────
     if (data.score_trend.length) {
       new Chart(document.getElementById('scoreTrendChart'), {
         type: 'line',
         data: {
           labels: data.score_trend.map(p => formatShortDate(p.date)),
           datasets: [
             { label: 'Overall', data: data.score_trend.map(p => p.overall), borderColor: CHART_COLORS.primary, backgroundColor: 'rgba(99,102,241,0.15)', tension: 0.35, fill: true },
             { label: 'Technical', data: data.score_trend.map(p => p.technical), borderColor: CHART_COLORS.cyan, tension: 0.35 },
             { label: 'Soft Skills', data: data.score_trend.map(p => p.soft_skills), borderColor: CHART_COLORS.accent, tension: 0.35 },
           ]
         },
         options: {
           responsive: true, maintainAspectRatio: false,
           scales: { y: { min: 0, max: 10, grid: { color: CHART_COLORS.gridLine } }, x: { grid: { display: false } } },
           plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 14 } } }
         }
       });
     } else {
       document.getElementById('scoreTrendChart').replaceWith(chartEmptyEl('Take a mock interview to see your score trend.'));
     }
   
     // ── Skill radar ──────────────────────────────────────
     const radar = data.skill_radar;
     const hasRadarData = Object.values(radar).some(v => v > 0);
     if (hasRadarData) {
       new Chart(document.getElementById('skillRadarChart'), {
         type: 'radar',
         data: {
           labels: ['Technical', 'Soft Skills', 'Eye Contact', 'Confidence', 'Engagement'],
           datasets: [{
             label: 'You', data: [radar.technical, radar.soft_skills, radar.eye_contact, radar.confidence, radar.engagement],
             borderColor: CHART_COLORS.primary, backgroundColor: 'rgba(99,102,241,0.25)', pointBackgroundColor: CHART_COLORS.accent
           }]
         },
         options: {
           responsive: true, maintainAspectRatio: false,
           scales: { r: { min: 0, max: 10, grid: { color: CHART_COLORS.gridLine }, angleLines: { color: CHART_COLORS.gridLine }, pointLabels: { color: CHART_COLORS.text, font: { size: 11 } }, ticks: { display: false } } },
           plugins: { legend: { display: false } }
         }
       });
     } else {
       document.getElementById('skillRadarChart').replaceWith(chartEmptyEl('Complete an interview to unlock your skill breakdown.'));
     }
   
     // ── Aptitude topic breakdown (bar) ───────────────────
     if (data.aptitude_topic_breakdown.length) {
       new Chart(document.getElementById('topicBarChart'), {
         type: 'bar',
         data: {
           labels: data.aptitude_topic_breakdown.map(t => t.topic.replace(/_/g, ' ')),
           datasets: [{ label: 'Accuracy %', data: data.aptitude_topic_breakdown.map(t => t.avg_score_percent), backgroundColor: CHART_COLORS.cyan, borderRadius: 6 }]
         },
         options: {
           indexAxis: 'y', responsive: true, maintainAspectRatio: false,
           scales: { x: { min: 0, max: 100, grid: { color: CHART_COLORS.gridLine } }, y: { grid: { display: false } } },
           plugins: { legend: { display: false } }
         }
       });
     } else {
       document.getElementById('topicBarChart').replaceWith(chartEmptyEl('Take an Aptitude Test to see topic-wise accuracy.'));
     }
   
     // ── Practice mix (doughnut) ───────────────────────────
     const counts = {
       Interviews: data.overview_total_interviews,
       Aptitude: data.overview_total_aptitude,
       Coding: data.overview_total_coding
     };
     const hasMix = Object.values(counts).some(v => v > 0);
     if (hasMix) {
       new Chart(document.getElementById('practiceMixChart'), {
         type: 'doughnut',
         data: {
           labels: Object.keys(counts),
           datasets: [{ data: Object.values(counts), backgroundColor: [CHART_COLORS.primary, CHART_COLORS.cyan, CHART_COLORS.success], borderColor: 'transparent' }]
         },
         options: {
           responsive: true, maintainAspectRatio: false,
           plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 14 } } }
         }
       });
     } else {
       document.getElementById('practiceMixChart').replaceWith(chartEmptyEl('Your practice activity mix shows up here.'));
     }
   }
   
   function chartEmptyEl(text) {
     const div = document.createElement('div');
     div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.4);font-size:0.85rem;text-align:center;padding:1rem;';
     div.textContent = text;
     return div;
   }
   
   async function loadAnalytics() {
     try {
       const data = await apiGet('/api/analytics/summary');
   
       // flatten a couple of counts onto the object for the doughnut chart above
       data.overview_total_interviews = data.overview.total_interviews;
       data.overview_total_aptitude = data.overview.total_aptitude_attempts;
       data.overview_total_coding = data.overview.total_coding_attempts;
   
       renderStats(data.overview);
   
       if (!data.has_any_activity) {
         renderEmptyState();
         return;
       }
       renderBody(data);
     } catch (err) {
       console.error('Analytics error:', err);
       document.getElementById('statsGrid').innerHTML = '<div style="color:#f87171;padding:1rem">Could not load analytics. Is the backend running?</div>';
       showToast('Could not load your analytics right now.', true);
     }
   }
   
   loadAnalytics();