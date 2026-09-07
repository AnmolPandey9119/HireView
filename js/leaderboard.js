/* ════════════════════════════════════════════════
   HireView — Leaderboard page
   Talks to GET /api/leaderboard (routes/leaderboard.py). Ranking math
   (the HireView Score composite) happens entirely server-side; this
   file only renders whatever comes back. Only display_name + rank +
   score are ever sent to the browser — no email, no per-attempt data.
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
   
   let lbCurrentPeriod = 'all';
   
   function medalFor(rank) {
     return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
   }
   
   function activityMeta(row) {
     const parts = [];
     if (row.total_interviews) parts.push(`${row.total_interviews} interview${row.total_interviews > 1 ? 's' : ''}`);
     if (row.total_aptitude) parts.push(`${row.total_aptitude} aptitude`);
     if (row.total_coding) parts.push(`${row.total_coding} coding`);
     return parts.join(' · ') || 'No activity yet';
   }
   
   function renderYouCard(you, totalRanked) {
     const wrap = document.getElementById('lbYouWrap');
     if (!you) {
       wrap.innerHTML = `
         <div class="lb-you-card">
           <div class="lb-you-left">
             <div class="lb-you-rank">—</div>
             <div>
               <div class="lb-you-name">You're not ranked yet</div>
               <div class="lb-you-sub">Complete an Interview, Aptitude Test or Coding round to get on the board.</div>
             </div>
           </div>
         </div>`;
       return;
     }
     wrap.innerHTML = `
       <div class="lb-you-card">
         <div class="lb-you-left">
           <div class="lb-you-rank">#${you.rank}</div>
           <div>
             <div class="lb-you-name">Your rank ${totalRanked ? `(of ${totalRanked})` : ''}</div>
             <div class="lb-you-sub">${escapeHtml(activityMeta(you))}</div>
           </div>
         </div>
         <div class="lb-you-score">${you.score}</div>
       </div>`;
   }
   
   function renderEmpty() {
     document.getElementById('lbBody').innerHTML = `
       <div class="empty-lb">
         <div class="empty-lb-icon">🏆</div>
         <div class="empty-lb-title">No one's on the board yet</div>
         <div class="empty-lb-sub">Be the first — complete an Interview, Aptitude Test or Coding round to claim #1.</div>
         <button class="primary-btn" onclick="window.location.href='/dashboard'">Start Practicing →</button>
       </div>`;
   }
   
   function renderBody(top) {
     const podium = top.slice(0, 3);
     const rest = top.slice(3);
   
     let html = '';
     if (podium.length) {
       html += `<div class="lb-podium">`;
       podium.forEach(row => {
         html += `
           <div class="lb-podium-card rank-${row.rank}${row.is_you ? ' is-you' : ''}">
             <div class="lb-podium-medal">${medalFor(row.rank)}</div>
             <div class="lb-podium-name">${escapeHtml(row.display_name)}${row.is_you ? ' (You)' : ''}</div>
             <div class="lb-podium-score">${row.score}</div>
             <div class="lb-podium-sub">${escapeHtml(activityMeta(row))}</div>
           </div>`;
       });
       html += `</div>`;
     }
   
     if (rest.length) {
       html += `<div class="lb-list">`;
       rest.forEach(row => {
         html += `
           <div class="lb-row${row.is_you ? ' is-you' : ''}">
             <div class="lb-row-rank">#${row.rank}</div>
             <div>
               <div class="lb-row-name">${escapeHtml(row.display_name)}${row.is_you ? ' (You)' : ''}</div>
               <div class="lb-row-meta">${escapeHtml(activityMeta(row))}</div>
             </div>
             <div class="lb-row-score">${row.score}</div>
           </div>`;
       });
       html += `</div>`;
     }
   
     document.getElementById('lbBody').innerHTML = html;
   }
   
   async function loadLeaderboard(period) {
     document.getElementById('lbBody').innerHTML = `
       <div class="loading-shimmer"></div><div class="loading-shimmer"></div><div class="loading-shimmer"></div>`;
     try {
       const data = await apiGet(`/api/leaderboard?period=${period}&limit=50`);
       renderYouCard(data.you, data.total_ranked_users);
       if (!data.top.length) {
         renderEmpty();
         return;
       }
       renderBody(data.top);
     } catch (err) {
       console.error('Leaderboard error:', err);
       document.getElementById('lbBody').innerHTML = '<div style="color:#f87171;padding:1rem">Could not load the leaderboard. Is the backend running?</div>';
       showToast('Could not load the leaderboard right now.', true);
     }
   }
   
   document.querySelectorAll('.lb-tab').forEach(tab => {
     tab.addEventListener('click', () => {
       if (tab.classList.contains('active')) return;
       document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
       tab.classList.add('active');
       lbCurrentPeriod = tab.dataset.period;
       loadLeaderboard(lbCurrentPeriod);
     });
   });
   
   loadLeaderboard(lbCurrentPeriod);