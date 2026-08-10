# ============================================================
# Website Assistant Routes
# File: routes/assistant.py
#
# A public, unauthenticated chat endpoint that powers the little
# chat-bubble widget on the marketing site (js/assistant-widget.js).
# Unlike /api/chat in interviews.py, there's no logged-in user and
# no interview_id to tie a call to — so this file has its own,
# stricter safeguards:
#   - per-IP rate limiting (in-memory; fine for a single Render
#     instance, resets on redeploy — good enough for a support widget)
#   - hard caps on message count / length so one visitor can't run
#     up an API bill or use this as a free-form LLM proxy
#   - a fixed system prompt that keeps answers scoped to HireView
# ============================================================

import time
import logging
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from routes.interviews import _call_groq, _call_gemini

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================================================
# SAFEGUARDS
# ============================================================
MAX_MESSAGES_IN_PAYLOAD = 20      # visitor turns + assistant turns, combined
MAX_MESSAGE_CHARS = 1000          # a support question doesn't need more than this
SERVER_MAX_TOKENS = 400           # replies stay short — this is a widget, not an essay
RATE_LIMIT_WINDOW_SECONDS = 60 * 60
RATE_LIMIT_MAX_REQUESTS = 20      # per IP, per hour

# ip -> deque of unix timestamps of recent requests
_request_log: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(ip: str):
    now = time.time()
    log = _request_log[ip]
    while log and now - log[0] > RATE_LIMIT_WINDOW_SECONDS:
        log.popleft()
    if len(log) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=429,
            detail="Too many messages from this device right now. Please try again in a bit."
        )
    log.append(now)


# ============================================================
# SYSTEM PROMPT
# Keeps the assistant scoped to HireView itself. Sourced from the
# site's own FAQ content so answers stay accurate without needing
# to call out to the rest of the app.
# ============================================================
SYSTEM_PROMPT = """You are the website assistant for HireView (hireview-ai.vercel.app), \
answering questions from visitors in a small chat widget. Be warm, concise, and helpful — \
most answers should be 2-4 sentences. Use plain text, no markdown headers.

Facts about HireView:
- HireView is an AI-powered mock interview platform for Indian job seekers.
- The AI interviewer is named Arjun. Arjun reads the candidate's resume or biodata, asks \
questions tailored to their background, adapts difficulty based on their answers, listens \
to spoken answers, and speaks back in real time using voice.
- It supports government exam interview practice too (UPSC, SSC, IBPS), using a dedicated \
government-sector mode with domain-specific prompts.
- Interviews can be conducted in English or Hinglish, with more Indian regional languages \
being added.
- Pricing: a free trial with 3 mock interviews, then a Weekly plan at ₹99 (7 days) or a \
Monthly plan at ₹299 (30 days), both with unlimited interviews during the active period.
- It monitors face presence, tab/window switches, background noise, and clipboard activity \
during interviews, ending sessions early on repeated violations, and includes an integrity \
score in the final feedback report.
- It runs entirely in the browser — just a webcam, mic, and stable internet connection, no \
extra software.
- Resume parsing and interview data are handled through a secure backend per HireView's \
Privacy Policy (linked in the site footer).
- Support/contact: hireviewadmin@gmail.com.

If asked something you don't know or that isn't about HireView, say so honestly and point \
them to hireviewadmin@gmail.com rather than guessing. Never invent pricing, features, or \
policies not listed above."""


@router.post("/assistant/chat")
async def assistant_chat(payload: dict, request: Request):
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    messages = payload.get("messages", [])
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages is required")
    if len(messages) > MAX_MESSAGES_IN_PAYLOAD:
        raise HTTPException(status_code=400, detail="Conversation is too long for this widget")

    cleaned = []
    for m in messages:
        role = m.get("role")
        content = str(m.get("content", ""))[:MAX_MESSAGE_CHARS]
        if role not in ("user", "assistant") or not content.strip():
            continue
        cleaned.append({"role": role, "content": content})

    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid messages provided")

    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + cleaned

    try:
        result = await _call_groq(full_messages, temperature=0.6, max_tokens=SERVER_MAX_TOKENS)
        logger.info("/api/assistant/chat served by Groq")
        return result
    except RuntimeError as e:
        logger.warning(f"Groq unavailable for assistant chat ({e}) — falling back to Gemini")

    try:
        result = await _call_gemini(full_messages, temperature=0.6, max_tokens=SERVER_MAX_TOKENS)
        logger.info("/api/assistant/chat served by Gemini (fallback)")
        return result
    except RuntimeError as e:
        logger.error(f"Gemini fallback also unavailable for assistant chat: {e}")
        raise HTTPException(status_code=503, detail="Assistant is temporarily unavailable, please try again shortly")