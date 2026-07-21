# ============================================================
# Interview Routes
# File: routes/interviews.py
# Create interviews, save Q&A, store feedback, view history
# ============================================================

import httpx
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import logging
import json

from models.database import get_db, Interview, InterviewQuestion, Feedback, User
from models.schemas import InterviewCreate, QuestionAnswer, InterviewResponse, FeedbackCreate
from routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# POST /api/interviews — Start a new interview session
# ============================================================
@router.post("/interviews", response_model=InterviewResponse)
async def create_interview(
    payload: InterviewCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
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
        next_steps=payload.next_steps
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
            "next_steps": feedback.next_steps
        }

    return {
        "id": interview.id,
        "role": interview.role,
        "difficulty": interview.difficulty,
        "status": interview.status,
        "overall_score": interview.overall_score,
        "started_at": interview.started_at,
        "completed_at": interview.completed_at,
        "sector": interview.sector,
        "government_domain": interview.government_domain,
        "government_role": interview.government_role,
        "biodata_source": interview.biodata_source,
        "candidate_summary": interview.candidate_summary,
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
    interviews = db.query(Interview).filter(
        Interview.user_id == current_user.id
    ).order_by(Interview.started_at.desc()).all()

    total = len(interviews)
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
            "started_at": i.started_at.isoformat() if i.started_at else None,
            "completed_at": i.completed_at.isoformat() if i.completed_at else None,
            "sector": i.sector,
            "government_domain": i.government_domain,
            "government_role": i.government_role
        })

    return {
        "user": {
            "name": current_user.name,
            "email": current_user.email,
            "profile_picture": current_user.profile_picture,
            "subscription_plan": current_user.subscription_plan,
            "subscription_active_until": current_user.subscription_active_until
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
    # सिर्फ meaningful interviews दिखाएं — date wise, newest first
    interviews = db.query(Interview).filter(
        Interview.user_id == current_user.id,
        Interview.status.in_(["completed", "cheating_terminated"])
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
                "next_steps": feedback.next_steps
            }

        result.append({
            "id": i.id,
            "role": i.role,
            "status": i.status,
            "overall_score": i.overall_score,
            "started_at": i.started_at.isoformat() if i.started_at else None,
            "completed_at": i.completed_at.isoformat() if i.completed_at else None,
            "sector": i.sector,
            "government_domain": i.government_domain,
            "government_role": i.government_role,
            "candidate_summary": i.candidate_summary,
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
# POST /api/chat — Groq API proxy (secure, key stays on server)
# ============================================================
@router.post("/chat")
async def chat_with_groq(
    request: dict,
    current_user: User = Depends(get_current_user)
):
    groq_key = os.environ.get("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(status_code=500, detail="Groq API key not configured")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "openai/gpt-oss-120b",
                "messages": request.get("messages", []),
                "temperature": request.get("temperature", 0.7),
                "max_tokens": request.get("max_tokens", 800)
            },
            timeout=30.0
        )

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail="Groq API error")

    return response.json()