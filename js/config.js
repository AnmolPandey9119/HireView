// ════════════════════════════════════════════════
// HireView AI — Global Config
// ════════════════════════════════════════════════

const BACKEND_URL = 'https://hireview-qu8g.onrender.com';
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