# ============================================================
# HireView Backend Server
# File: main.py
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

import config
from models.database import init_db
from routes import auth, interviews, admin, visits, payments, assistant, questions, aptitude, coding, analytics, leaderboard

# ============================================================
# LOGGING
# ============================================================
logging.basicConfig(
    level=config.LOG_LEVEL,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(config.LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ============================================================
# CREATE APP
# ============================================================
app = FastAPI(title="HireView-AI Backend")

# ============================================================
# CORS
# The frontend uses Bearer-token auth (no cookies), so credentials
# don't need to be enabled. allow_origin_regex covers every Vercel
# preview/production URL automatically so you never have to hardcode
# a new domain every time Vercel gives you a fresh deployment URL.
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=config.ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# SECURITY HEADERS
# Defense-in-depth on every response — this is a pure JSON API (no
# server-rendered HTML, no cookies), so most of the usual browser-attack
# surface (XSS via reflected HTML, CSRF via cookies) doesn't apply here
# in the first place. These headers are the standard extra layer anyway:
#   - X-Content-Type-Options: stops browsers guessing a response is
#     something other than JSON and executing it as script/HTML.
#   - X-Frame-Options: this API is never meant to be iframed.
#   - Referrer-Policy: don't leak full request URLs (which can include
#     auth-adjacent query params) to third parties via the Referer header.
#   - Strict-Transport-Security: Render always serves this over HTTPS,
#     so pin browsers to HTTPS-only for this host going forward.
# Wrapped in try/except deliberately: this middleware must NEVER be the
# reason a request fails. If header-writing itself somehow throws, the
# original response/exception still passes through untouched instead of
# a broken middleware swallowing the real error (see the CORS incident
# this app just had — an unhandled exception anywhere in the stack skips
# CORS headers entirely, which the browser then misreports as a CORS
# error instead of the real 500. Never add a second way for that to happen).
# ============================================================
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    try:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    except Exception:
        logger.exception("Failed to set security headers (response still sent)")
    return response

# ============================================================
# ROUTES
# ============================================================
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(interviews.router, prefix="/api", tags=["Interviews"])
app.include_router(admin.router, prefix="/api", tags=["Admin"])
app.include_router(visits.router, prefix="/api", tags=["Visits"])
app.include_router(payments.router, prefix="/api", tags=["Payments"])
app.include_router(assistant.router, prefix="/api", tags=["Assistant"])
app.include_router(questions.router, prefix="/api", tags=["Questions"])
app.include_router(aptitude.router, prefix="/api", tags=["Aptitude"])
app.include_router(coding.router, prefix="/api", tags=["Coding"])
app.include_router(analytics.router, prefix="/api", tags=["Analytics"])
app.include_router(leaderboard.router, prefix="/api", tags=["Leaderboard"])

@app.get("/")
async def root():
    return {"message": "HireView Backend is running! 🚀"}

@app.get("/api/health")
async def health():
    return {"status": "ok", "database": True}

@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("Database ready")
    logger.info(f"Server running at http://localhost:{config.PORT}")
    logger.info(f"API docs at http://localhost:{config.PORT}/docs")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=config.DEBUG)