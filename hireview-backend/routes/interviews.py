# ============================================================
# Interview Routes
# File: routes/interviews.py
# Create interviews, save Q&A, store feedback, view history
# ============================================================

import httpx
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import logging
import json

from models.database import get_db, Interview, InterviewQuestion, Feedback, User, to_utc_iso
from models.schemas import InterviewCreate, QuestionAnswer, InterviewResponse, FeedbackCreate, FailInterviewRequest
from routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# Extra buffer (beyond the interview's own duration_limit) before we treat
# a still-"in_progress" interview as abandoned rather than genuinely active.
STALE_GRACE_SECONDS = 15 * 60  # 15 minutes


# ============================================================
# Auto-heal stale "in_progress" interviews
# Runs on every read of dashboard/history/list so a candidate never
# needs a cron job to clean this up. Any interview stuck in_progress
# well past its own time limit gets marked "failed" with a real
# reason instead of hanging forever — and stops eating the free quota.
# ============================================================
def _reconcile_stale_interviews(db: Session, user_id: int):
    now = datetime.utcnow()
    stuck = db.query(Interview).filter(
        Interview.user_id == user_id,
        Interview.status == "in_progress"
    ).all()

    changed = False
    for interview in stuck:
        limit = (interview.duration_limit or 300) + STALE_GRACE_SECONDS
        if not interview.started_at or (now - interview.started_at).total_seconds() <= limit:
            continue  # still genuinely within its active window

        has_answers = db.query(InterviewQuestion).filter(
            InterviewQuestion.interview_id == interview.id
        ).first() is not None

        interview.status = "failed"
        interview.completed_at = now
        interview.failure_reason = (
            "Interview was interrupted mid-session and never finished — likely a network drop, "
            "the browser/tab being closed, or a server error before the report could be generated."
            if has_answers else
            "Interview session never really started — likely a network issue, or the browser/tab "
            "was closed right after the session was created."
        )
        changed = True

    if changed:
        db.commit()


# ============================================================
# POST /api/interviews — Start a new interview session
# ============================================================
@router.post("/interviews", response_model=InterviewResponse)
async def create_interview(
    payload: InterviewCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Resolve any abandoned in_progress sessions first so the quota count
    # below is accurate (same reconciliation the dashboard already relies on).
    _reconcile_stale_interviews(db, current_user.id)

    now = datetime.utcnow()
    has_active_subscription = bool(
        current_user.subscription_active_until and current_user.subscription_active_until > now
    )

    if not has_active_subscription:
        # "failed" sessions don't count against the quota — same rule the
        # dashboard's interviews_remaining_free uses, so the two stay in sync.
        used = db.query(Interview).filter(
            Interview.user_id == current_user.id,
            Interview.status != "failed"
        ).count()

        if used >= 3:
            raise HTTPException(
                status_code=402,
                detail="You've used all 3 free interviews. Please purchase a plan to continue."
            )

    interview = Interview(
        user_id=current_user.id,
        role=payload.role,
        difficulty=payload.difficulty,
        duration_limit=payload.duration_limit,
        status="in_progress",
        sector=payload.sector,
        government_domain=payload.government_domain,
        government_role=payload.government_role,
        biodata=payload.biodata,
        biodata_source=payload.biodata_source,
        candidate_summary=payload.candidate_summary,
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)

    logger.info(f"Interview started: user={current_user.email}, role={payload.role}")
    return InterviewResponse.model_validate(interview)


# ============================================================
# POST /api/interviews/{id}/questions — Save one Q&A pair
# ============================================================
@router.post("/interviews/{interview_id}/questions")
async def add_question_answer(
    interview_id: int,
    payload: QuestionAnswer,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.user_id == current_user.id
    ).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    qa = InterviewQuestion(
        interview_id=interview_id,
        question_text=payload.question_text,
        answer_text=payload.answer_text,
        order_index=payload.order_index
    )
    db.add(qa)
    db.commit()
    db.refresh(qa)

    return {"status": "saved", "question_id": qa.id}


# ============================================================
# POST /api/interviews/{id}/feedback — Save final report
# ============================================================
@router.post("/interviews/{interview_id}/feedback")
async def save_feedback(
    interview_id: int,
    payload: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.user_id == current_user.id
    ).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    existing = db.query(Feedback).filter(Feedback.interview_id == interview_id).first()
    if existing:
        db.delete(existing)
        db.commit()

    feedback = Feedback(
        interview_id=interview_id,
        overall_score=payload.overall_score,
        hiring_recommendation=payload.hiring_recommendation,
        summary=payload.summary,
        technical_score=payload.technical_score,
        soft_skills_score=payload.soft_skills_score,
        eye_contact_score=payload.eye_contact_score,
        confidence_score=payload.confidence_score,
        engagement_score=payload.engagement_score,
        strengths=json.dumps(payload.strengths or []),
        areas_to_improve=json.dumps(payload.areas_to_improve or []),
        next_steps=payload.next_steps,
        personal_note=payload.personal_note
    )
    db.add(feedback)

    interview.status = "completed"
    interview.overall_score = payload.overall_score
    interview.completed_at = datetime.utcnow()
    db.commit()

    logger.info(f"Interview {interview_id} completed, score={payload.overall_score}")
    return {"status": "saved", "interview_id": interview_id}


# ============================================================
# GET /api/interviews — List history for current user
# ============================================================
@router.get("/interviews", response_model=list[InterviewResponse])
async def list_interviews(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _reconcile_stale_interviews(db, current_user.id)

    interviews = db.query(Interview).filter(
        Interview.user_id == current_user.id
    ).order_by(Interview.started_at.desc()).all()

    return [InterviewResponse.model_validate(i) for i in interviews]


# ============================================================
# GET /api/interviews/{id} — Full detail (Q&A + feedback)
# ============================================================
@router.get("/interviews/{interview_id}")
async def get_interview_detail(
    interview_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.user_id == current_user.id
    ).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    questions = db.query(InterviewQuestion).filter(
        InterviewQuestion.interview_id == interview_id
    ).order_by(InterviewQuestion.order_index).all()

    feedback = db.query(Feedback).filter(Feedback.interview_id == interview_id).first()

    feedback_data = None
    if feedback:
        feedback_data = {
            "overall_score": feedback.overall_score,
            "hiring_recommendation": feedback.hiring_recommendation,
            "summary": feedback.summary,
            "technical_score": feedback.technical_score,
            "soft_skills_score": feedback.soft_skills_score,
            "eye_contact_score": feedback.eye_contact_score,
            "confidence_score": feedback.confidence_score,
            "engagement_score": feedback.engagement_score,
            "strengths": json.loads(feedback.strengths or "[]"),
            "areas_to_improve": json.loads(feedback.areas_to_improve or "[]"),
            "next_steps": feedback.next_steps,
            "personal_note": feedback.personal_note
        }

    return {
        "id": interview.id,
        "role": interview.role,
        "difficulty": interview.difficulty,
        "status": interview.status,
        "overall_score": interview.overall_score,
        "started_at": to_utc_iso(interview.started_at),
        "completed_at": to_utc_iso(interview.completed_at),
        "sector": interview.sector,
        "government_domain": interview.government_domain,
        "government_role": interview.government_role,
        "biodata_source": interview.biodata_source,
        "candidate_summary": interview.candidate_summary,
        "failure_reason": interview.failure_reason,
        "questions": [
            {"question_text": q.question_text, "answer_text": q.answer_text, "order_index": q.order_index}
            for q in questions
        ],
        "feedback": feedback_data
    }


# ============================================================
# GET /api/dashboard — User stats for dashboard
# ============================================================
@router.get("/dashboard")
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _reconcile_stale_interviews(db, current_user.id)

    interviews = db.query(Interview).filter(
        Interview.user_id == current_user.id
    ).order_by(Interview.started_at.desc()).all()

    # "failed" sessions were wasted through no fault of the candidate's —
    # they don't count as a used attempt, so they're excluded from both
    # the total and the free-trial quota.
    countable = [i for i in interviews if i.status != "failed"]
    total = len(countable)
    completed = [i for i in interviews if i.status == 'completed']
    scores = [i.overall_score for i in completed if i.overall_score is not None]

    avg_score = round(sum(scores) / len(scores), 1) if scores else 0
    best_score = round(max(scores), 1) if scores else 0

    recent = []
    for i in interviews[:5]:
        recent.append({
            "id": i.id,
            "role": i.role,
            "status": i.status,
            "overall_score": i.overall_score,
            "started_at": to_utc_iso(i.started_at),
            "completed_at": to_utc_iso(i.completed_at),
            "sector": i.sector,
            "government_domain": i.government_domain,
            "government_role": i.government_role,
            "failure_reason": i.failure_reason
        })

    return {
        "user": {
            "name": current_user.name,
            "email": current_user.email,
            "profile_picture": current_user.profile_picture,
            "subscription_plan": current_user.subscription_plan,
            "subscription_active_until": to_utc_iso(current_user.subscription_active_until)
        },
        "stats": {
            "total_interviews": total,
            "completed_interviews": len(completed),
            "average_score": avg_score,
            "best_score": best_score,
            "interviews_remaining_free": max(0, 3 - total)
        },
        "recent_interviews": recent
    }


# ============================================================
# GET /api/history — Full interview history with feedback
# ============================================================
@router.get("/history")
async def get_interview_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _reconcile_stale_interviews(db, current_user.id)

    # completed + cheating_terminated + failed दिखाएं (failed भी दिखाना है ताकि
    # user को पता रहे reason क्या था) — बस genuinely-active in_progress छुपाएं
    interviews = db.query(Interview).filter(
        Interview.user_id == current_user.id,
        Interview.status.in_(["completed", "cheating_terminated", "failed"])
    ).order_by(Interview.started_at.desc()).all()

    result = []
    for i in interviews:
        questions = db.query(InterviewQuestion).filter(
            InterviewQuestion.interview_id == i.id
        ).order_by(InterviewQuestion.order_index).all()

        feedback = db.query(Feedback).filter(
            Feedback.interview_id == i.id
        ).first()

        feedback_data = None
        if feedback:
            feedback_data = {
                "overall_score": feedback.overall_score,
                "hiring_recommendation": feedback.hiring_recommendation,
                "summary": feedback.summary,
                "technical_score": feedback.technical_score,
                "soft_skills_score": feedback.soft_skills_score,
                "strengths": json.loads(feedback.strengths or "[]"),
                "areas_to_improve": json.loads(feedback.areas_to_improve or "[]"),
                "next_steps": feedback.next_steps,
                "personal_note": feedback.personal_note
            }

        result.append({
            "id": i.id,
            "role": i.role,
            "status": i.status,
            "overall_score": i.overall_score,
            "started_at": to_utc_iso(i.started_at),
            "completed_at": to_utc_iso(i.completed_at),
            "sector": i.sector,
            "government_domain": i.government_domain,
            "government_role": i.government_role,
            "candidate_summary": i.candidate_summary,
            "failure_reason": i.failure_reason,
            "questions": [
                {
                    "question_text": q.question_text,
                    "answer_text": q.answer_text,
                    "order_index": q.order_index
                } for q in questions
            ],
            "feedback": feedback_data
        })

    return result


# ============================================================
# POST /api/interviews/{id}/fail — Frontend reports a failure reason
# (network drop, API error, mic/cam issue, tab closed mid-session)
# so the interview doesn't linger as "in_progress" forever, and
# doesn't count against the free-trial quota.
# ============================================================
@router.post("/interviews/{interview_id}/fail")
async def fail_interview(
    interview_id: int,
    payload: FailInterviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.user_id == current_user.id
    ).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    # Already reached a final state (e.g. feedback saved right before the
    # tab closed) — don't overwrite a real result with a late failure report.
    if interview.status in ("completed", "cheating_terminated", "failed"):
        return {"status": interview.status, "interview_id": interview_id}

    interview.status = "failed"
    interview.completed_at = datetime.utcnow()
    interview.failure_reason = (payload.reason or "Interview could not be completed.").strip()[:500]
    db.commit()

    logger.info(f"Interview {interview_id} marked failed: {interview.failure_reason}")
    return {"status": "failed", "interview_id": interview_id}


# ============================================================
# POST /api/interviews/{id}/terminate — Cheating terminated
# ============================================================
@router.post("/interviews/{interview_id}/terminate")
async def terminate_interview(
    interview_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.user_id == current_user.id
    ).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    interview.status = "cheating_terminated"
    interview.completed_at = datetime.utcnow()
    db.commit()

    return {"status": "terminated", "interview_id": interview_id}


# ============================================================
# DELETE /api/interviews/cleanup — पुराने incomplete interviews हटाएं
# ============================================================
@router.delete("/interviews/cleanup")
async def cleanup_old_interviews(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=7)

    # 7 दिन से पुराने in_progress interviews delete करें
    old = db.query(Interview).filter(
        Interview.user_id == current_user.id,
        Interview.status == "in_progress",
        Interview.started_at < cutoff
    ).all()

    count = len(old)
    for interview in old:
        db.delete(interview)
    db.commit()

    return {"deleted": count, "message": f"Cleaned up {count} old incomplete interviews"}


# ============================================================
# POST /api/chat — Groq API proxy, with Gemini as a free fallback
# Both keys stay server-side; frontend contract (data.choices[0]
# .message.content) is unchanged no matter which provider answers.
# ============================================================

# Statuses worth failing over on: 429 (rate/quota), 5xx (provider down),
# 404 (model retired/renamed by the provider — a config problem on their
# end, not a bad prompt, so it's worth trying the other provider).
# A 4xx like 400/401 is a real request/auth problem — retrying on a
# different provider won't fix a bad prompt or a bad key, so we don't.
_FAILOVER_STATUSES = {404, 429, 500, 502, 503, 504}


async def _call_groq(messages: list, temperature: float, max_tokens: int) -> dict:
    """Calls Groq. Raises RuntimeError on any failure so the caller can decide
    whether to fail over to Gemini."""
    groq_key = os.environ.get("GROQ_API_KEY")
    if not groq_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "openai/gpt-oss-120b",
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            },
            timeout=30.0
        )

    if response.status_code != 200:
        logger.warning(f"Groq call failed: {response.status_code} {response.text[:300]}")
        if response.status_code in _FAILOVER_STATUSES:
            raise RuntimeError(f"groq_failover:{response.status_code}")
        raise HTTPException(status_code=response.status_code, detail="Groq API error")

    result = response.json()
    result["_provider"] = "groq"  # harmless extra field, useful for debugging in logs/devtools
    return result


def _messages_to_gemini(messages: list):
    """OpenAI-style [{role, content}, ...] -> Gemini's
    (system_instruction_text_or_None, contents_list)."""
    system_parts = []
    contents = []
    for m in messages:
        role = m.get("role", "user")
        text = m.get("content", "")
        if role == "system":
            system_parts.append(text)
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": text}]})
        else:
            contents.append({"role": "user", "parts": [{"text": text}]})
    system_instruction = "\n\n".join(system_parts) if system_parts else None
    return system_instruction, contents


async def _call_gemini(messages: list, temperature: float, max_tokens: int) -> dict:
    """Calls Gemini and reshapes the response into the same
    {"choices": [{"message": {"role": "assistant", "content": "..."}}]}
    shape the frontend already expects from Groq."""
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    system_instruction, contents = _messages_to_gemini(messages)
    # gemini-2.5-flash-lite was retired for new API keys (Google now returns
    # 404 "no longer available to new users") — gemini-3.1-flash-lite is
    # Google's direct low-cost/low-latency successor. Check current model
    # availability at ai.google.dev if this needs to change again.
    model = "gemini-3.1-flash-lite"

    body = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens
        }
    }
    if system_instruction:
        body["system_instruction"] = {"parts": [{"text": system_instruction}]}

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={
                "x-goog-api-key": gemini_key,
                "Content-Type": "application/json"
            },
            json=body,
            timeout=30.0
        )

    if response.status_code != 200:
        logger.warning(f"Gemini call failed: {response.status_code} {response.text[:300]}")
        # Same failover contract as _call_groq: a retryable/provider-side
        # status raises RuntimeError so the caller can fail over to Groq.
        # Previously this always raised HTTPException here, which skipped
        # the Groq fallback entirely and sent the raw error straight to
        # the frontend — that's the bug that broke feedback generation.
        if response.status_code in _FAILOVER_STATUSES:
            raise RuntimeError(f"gemini_failover:{response.status_code}")
        raise HTTPException(status_code=response.status_code, detail="Gemini API error")

    data = response.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        logger.error(f"Unexpected Gemini response shape: {json.dumps(data)[:300]}")
        # Malformed response is also worth failing over on rather than
        # hard-failing the whole request.
        raise RuntimeError("gemini_failover:bad_response_shape")

    # Reshape to match what the Groq/OpenAI-style response looked like,
    # so js/interview.js's `data.choices[0].message.content` keeps working.
    return {
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "_provider": "gemini"  # harmless extra field, useful for debugging in logs/devtools
    }


@router.post("/chat")
async def chat_with_groq(
    request: dict,
    current_user: User = Depends(get_current_user)
):
    messages = request.get("messages", [])
    temperature = request.get("temperature", 0.7)
    max_tokens = request.get("max_tokens", 800)
    # "feedback" = the one-shot end-of-interview report (quality matters more
    # than speed, so it goes to Gemini). Anything else = the live, turn-by-turn
    # question flow (latency matters most, so it goes to Groq). Each provider
    # still backs up the other so a single provider outage never breaks a session.
    task = request.get("task", "interview")

    if task == "feedback":
        primary, primary_name = _call_gemini, "Gemini"
        secondary, secondary_name = _call_groq, "Groq"
    else:
        primary, primary_name = _call_groq, "Groq"
        secondary, secondary_name = _call_gemini, "Gemini"

    try:
        result = await primary(messages, temperature, max_tokens)
        logger.info(f"/api/chat task='{task}' served by {primary_name}")
        return result
    except RuntimeError as e:
        logger.warning(f"{primary_name} unavailable for task='{task}' ({e}) — falling back to {secondary_name}")

    try:
        result = await secondary(messages, temperature, max_tokens)
        logger.info(f"/api/chat task='{task}' served by {secondary_name} (fallback)")
        return result
    except RuntimeError as e:
        logger.error(f"{secondary_name} fallback also unavailable: {e}")
        raise HTTPException(status_code=500, detail="No AI provider configured")