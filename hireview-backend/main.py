# ============================================================
# HireView Backend Server
# File: main.py
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

import config
from models.database import init_db
from routes import auth, interviews, admin, visits, payments, assistant, questions, aptitude

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