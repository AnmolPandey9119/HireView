// ════════════════════════════════════════════════
// Extracted from the original monolithic interview.js during Phase 0
// architecture cleanup. Still classic global-scope scripts (no ES
// modules / bundler introduced) — order of <script> tags in
// interview.html matters and must match the order below:
//   state.js -> setup.js -> media.js -> speech.js -> conversation.js -> recording.js
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// HireView AI — Interview Logic
// ════════════════════════════════════════════════

// Interview state
let conversationHistory = [];
let questionCount = 0;
let interviewStartTime = null;
let timerInterval = null;
let warningGiven = false;
let interviewEnded = false;
let interviewSucceeded = false; // true only once feedback is actually saved
let sessionFailureReported = false; // guards against reporting /fail more than once
let timeUpSignoffGiven = false;
let mediaStream = null;
// True once camera/mic access is denied or fails — used to flag the
// integrity report as "unmonitored" rather than silently reporting a
// false-clean verdict when no video-based checks ever actually ran.
let cameraUnavailable = false;
let cameraOn = true;
let recognition = null;
let isListening = false;
let recognitionRunning = false;
let speechBuffer = '';
let questionStartTime = null;
let responseTimes = [];

// Silence watchdog — Arjun shouldn't wait forever for an answer
let silenceWatcherId = null;
let lastSpeechActivityAt = null;
const SILENCE_TIMEOUT_MS = 30000; // 30 seconds
let answerInFlight = false; // guards against double-advancing (manual submit racing the timeout)

// Interview pacing — there's no fixed question count. Arjun decides when to
// wrap up based on elapsed time + how well he feels he's covered the
// candidate (see buildPacingNote()), the way a real interviewer would,
// instead of always asking exactly N questions. These bounds just keep
// that dynamic decision inside a sane, real-interview-length window.
const INTERVIEW_MIN_NATURAL_END_MINUTES = 28; // never let Arjun end early even if he feels "done"
const INTERVIEW_WARNING_MINUTES = 40;          // "we're coming up on time" nudge to the candidate
const INTERVIEW_HARD_CUTOFF_MINUTES = 48;      // absolute safety net if he hasn't wrapped up naturally

// Recognition health — some browsers (esp. Chrome) silently stop delivering
// results in long continuous sessions WITHOUT ever firing onend or onerror,
// leaving the mic looking "active" while nothing is actually being heard.
// We proactively rotate sessions before that can happen, and keep a hard
// fallback in case a rotation itself gets silently dropped.
let lastRecognitionStartAt = null;
const RECOGNITION_REFRESH_MS = 12000;       // rotate well before any browser-internal timeout
const RECOGNITION_STUCK_GRACE_MS = 5000;    // extra grace before declaring a session truly stuck

// Mic volume monitor — Web Speech API can't be fed a boosted/processed
// stream directly, so instead of silently mishearing quiet speakers we
// watch real mic input level and nudge the candidate to speak up/move
// closer when they've been consistently faint for a few seconds.
let audioContext = null;
let audioAnalyser = null;
let audioMonitorRafId = null;
let lowVolumeStreakMs = 0;
let lastVolumeSampleAt = null;
let lowVolumeNudgedThisTurn = false;
const LOW_VOLUME_RMS_THRESHOLD = 0.02;   // below this = "too quiet", above near-silence floor
const NEAR_SILENCE_RMS_FLOOR = 0.003;    // ignore true silence (not speaking at all)
const LOW_VOLUME_NUDGE_AFTER_MS = 4000;  // sustained faint speech before we say anything

// Voice-input reliability — Web Speech API depends on browser support, mic
// permission, AND a live connection to the browser vendor's cloud STT
// service. When any of those genuinely can't work for a moment, retrying
// forever just hides the problem from the candidate and burns battery.
// We cap retries within a short window, tell the candidate plainly, and
// let them keep going by typing — then give voice input a fresh chance
// again on the NEXT question (a wifi blip on question 2 shouldn't kill
// voice for the rest of a 30-45 minute interview).
let voiceInputDisabled = false;
let recentRecognitionErrors = []; // timestamps of network/audio-capture errors this turn
const RECOGNITION_ERROR_WINDOW_MS = 20000; // look at errors within this window
const RECOGNITION_ERROR_LIMIT = 4;         // this many within the window = stop retrying, not a blip

// ════════════════════════════════════════════════
// GOVERNMENT SECTOR — REGIONAL LANGUAGE SUPPORT
// Each entry: speechLang = BCP-47 code used for both TTS voice
// matching and STT (SpeechRecognition) language.
// promptName = how we describe the language to the AI in the system prompt.
// ════════════════════════════════════════════════
const GOV_LANGUAGES = {
  english:   { label: 'English',            speechLang: 'en-IN', promptName: 'clear, professional English' },
  hinglish:  { label: 'Hinglish',            speechLang: 'hi-IN', promptName: 'natural Hinglish (mix of Hindi and English in Roman script), exactly how Indian professionals talk in real interviews' },
  hindi:     { label: 'हिंदी (Hindi)',        speechLang: 'hi-IN', promptName: 'pure, natural Hindi (Devanagari script in spirit — respond as a native Hindi speaker would)' },
  bengali:   { label: 'বাংলা (Bengali)',      speechLang: 'bn-IN', promptName: 'natural Bengali, as a native Bengali speaker would in a formal interview' },
  tamil:     { label: 'தமிழ் (Tamil)',        speechLang: 'ta-IN', promptName: 'natural Tamil, as a native Tamil speaker would in a formal interview' },
  telugu:    { label: 'తెలుగు (Telugu)',      speechLang: 'te-IN', promptName: 'natural Telugu, as a native Telugu speaker would in a formal interview' },
  marathi:   { label: 'मराठी (Marathi)',      speechLang: 'mr-IN', promptName: 'natural Marathi, as a native Marathi speaker would in a formal interview' },
  gujarati:  { label: 'ગુજરાતી (Gujarati)',   speechLang: 'gu-IN', promptName: 'natural Gujarati, as a native Gujarati speaker would in a formal interview' },
  kannada:   { label: 'ಕನ್ನಡ (Kannada)',      speechLang: 'kn-IN', promptName: 'natural Kannada, as a native Kannada speaker would in a formal interview' },
  malayalam: { label: 'മലയാളം (Malayalam)',   speechLang: 'ml-IN', promptName: 'natural Malayalam, as a native Malayalam speaker would in a formal interview' },
  punjabi:   { label: 'ਪੰਜਾਬੀ (Punjabi)',     speechLang: 'pa-IN', promptName: 'natural Punjabi, as a native Punjabi speaker would in a formal interview' },
  odia:      { label: 'ଓଡ଼ିଆ (Odia)',         speechLang: 'or-IN', promptName: 'natural Odia, as a native Odia speaker would in a formal interview' },
  urdu:      { label: 'اردو (Urdu)',          speechLang: 'ur-IN', promptName: 'natural Urdu, as a native Urdu speaker would in a formal interview' }
};

function getLangConfig() {
  return GOV_LANGUAGES[selectedLanguage] || GOV_LANGUAGES.english;
}
let availableVoices = [];
// Recording
let mediaRecorder = null;
let recordedChunks = [];
let recordingChoice = null; // 'download' or 'none'

// New state for government sector
let selectedSector = null;
let biodataText = '';
let biodataFileName = '';
let biodataFileSize = 0;
let biodataSource = null; // 'upload' or 'form'

// Job Description (JD) — optional, private sector only
let jdText = '';
let jdFileName = '';
let jdFileSize = 0;
let jdSource = null; // 'paste' or 'upload'

// Interview round chosen — private sector only. 'technical' | 'hr' | 'mixed'.
// Set once in handleInterviewStart, read again at feedback-generation time
// so scoring can be matched to what this round actually assessed.
let currentInterviewRound = 'mixed';

// Job role options
const privateDomains = {
  technology: [
    "Software Engineer", "Full Stack Developer", "Frontend Developer", "Backend Developer",
    "AI/ML Engineer", "Data Scientist", "DevOps Engineer", "Cloud Engineer", "Cyber Security", "QA Engineer"
  ],
  hr_management: ["HR Manager", "Recruiter", "Talent Acquisition Specialist"],
  finance_banking: ["Financial Analyst", "Investment Banker", "Accountant"],
  marketing_sales: ["Marketing Manager", "Sales Executive", "Digital Marketer"],
  design_product: ["Product Designer", "UI/UX Designer", "Product Manager"]
};

const governmentDomains = {
  upsc: ["IAS", "IPS", "IFS"],
  ssc: ["CGL", "CHSL", "MTS", "CPO"],
  banking: ["IBPS PO", "IBPS Clerk", "SBI PO", "SBI Clerk", "RBI Assistant"],
  railway: ["RRB NTPC", "Group D", "JE"],
  defence: ["NDA", "CDS", "AFCAT", "Agniveer"],
  state_psc: ["State PSC"],
  teaching: ["CTET", "TET", "Lecturer"],
  police: ["Constable", "Sub Inspector", "Inspector"]
};

// Dynamic form data
let educationEntries = [];
let examEntries = [];
let experienceEntries = [];

// ════════════════════════════════════════════════
// SECTOR SELECTION
// ════════════════════════════════════════════════