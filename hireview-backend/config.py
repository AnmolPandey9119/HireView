# ============================================================
# HireView Backend Configuration
# File: config.py
# ============================================================

import os
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# PATHS
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR           = os.path.join(BASE_DIR, 'data')
VOICE_SAMPLES_DIR  = os.path.join(DATA_DIR, 'voice_samples')
AVATARS_DIR        = os.path.join(DATA_DIR, 'avatars')
RESUMES_DIR        = os.path.join(DATA_DIR, 'resumes')
TEMP_DIR           = os.path.join(BASE_DIR, 'temp')
LOGS_DIR           = os.path.join(BASE_DIR, 'logs')
DATABASE_DIR       = os.path.join(BASE_DIR, 'database')

# Create all directories if they don't exist
for directory in [DATA_DIR, VOICE_SAMPLES_DIR, AVATARS_DIR, RESUMES_DIR,
                   TEMP_DIR, LOGS_DIR, DATABASE_DIR]:
    os.makedirs(directory, exist_ok=True)

# ============================================================
# DATABASE
# ============================================================
DATABASE_PATH = os.path.join(DATABASE_DIR, 'hireview.db')
DATABASE_URL  = f"sqlite:///{DATABASE_PATH}"

# ============================================================
# AUTHENTICATION
# ============================================================
SECRET_KEY  = os.getenv("SECRET_KEY", "hireview-dev-secret-key-CHANGE-THIS-IN-PRODUCTION")
ALGORITHM   = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# ============================================================
# TTS CONFIGURATION (Voice Cloning)
# ============================================================
TTS_MODEL_NAME      = "tts_models/multilingual/multi-dataset/xtts_v2"
VOICE_SAMPLE_PATH   = os.path.join(VOICE_SAMPLES_DIR, 'anmol.wav')
DEFAULT_LANGUAGE    = "en"

# ============================================================
# WAV2LIP CONFIGURATION (Lip Sync)
# ============================================================
WAV2LIP_DIR        = os.path.join(BASE_DIR, "Wav2Lip")
WAV2LIP_CHECKPOINT = os.path.join(WAV2LIP_DIR, "checkpoints", "wav2lip_gan.pth")
AVATAR_IMAGE_PATH  = os.path.join(AVATARS_DIR, 'anmol.jpg')

# ============================================================
# SERVER CONFIGURATION
# ============================================================
HOST  = "0.0.0.0"
PORT  = int(os.getenv("PORT", 8000))
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# ============================================================
# CORS - Allow your frontend to call this backend
# Add your production Vercel URL to FRONTEND_URL as an env var once
# you know it (e.g. https://hireview.vercel.app). The regex below
# additionally allows ANY *.vercel.app URL, so preview deployments
# (which get a new URL every push) keep working without redeploying
# the backend every time.
# ============================================================
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:8000",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:3000",
]
_frontend_url = os.getenv("FRONTEND_URL")
if _frontend_url:
    ALLOWED_ORIGINS.append(_frontend_url.rstrip("/"))

ALLOWED_ORIGIN_REGEX = r"https://.*\.vercel\.app"

# ============================================================
# DEVICE (CPU or GPU)
# ============================================================
try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
except ImportError:
    DEVICE = "cpu"  # torch not installed yet — we'll add it when we build voice cloning

# ============================================================
# LIMITS
# ============================================================
MAX_FILE_SIZE_MB = 100
MAX_TEXT_LENGTH  = 5000

# ============================================================
# LOGGING
# ============================================================
LOG_FILE  = os.path.join(LOGS_DIR, 'app.log')
LOG_LEVEL = "INFO"