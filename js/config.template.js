// ════════════════════════════════════════════════
// HireView AI — Global Config
// (This is a template checked into git. The real value
// is injected at deploy time by build.js from the
// BACKEND_URL environment variable set in Vercel.)
// ════════════════════════════════════════════════

const BACKEND_URL = '__BACKEND_URL__';
const INTERVIEWER_NAME = 'Arjun';

// Auth token (localStorage से आएगा, यहाँ सिर्फ़ initialize)
let authToken = localStorage.getItem('hv_token') || null;
let currentUser = JSON.parse(localStorage.getItem('hv_user') || 'null');

// Interview state
let currentInterviewId = null;
let selectedLanguage = 'english';

// Resume state
let resumeText = '';
let resumeFileName = '';
let resumeFileSize = 0;