# ============================================================
# Admin Routes
# File: routes/admin.py
#
# A single pre-provisioned admin account (no self-registration —
# credentials come from ADMIN_USERNAME / ADMIN_PASSWORD_HASH env
# vars). Every route below except /admin/login requires a valid
# admin JWT (separate token type from normal user tokens — it
# carries {"admin": True} and a normal user token will NOT work
# here, and vice versa).
#
# Covers full CRUD on:
#   - Users
#   - Interviews
#   - Interview questions/answers
#   - Feedback
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import Optional
import logging

import config
from models.database import get_db, User, Interview, InterviewQuestion, Feedback
from models.auth_utils import hash_password, verify_password, create_access_token, decode_access_token
from models.schemas import (
    AdminLogin, AdminToken,
    AdminUserUpdate, AdminInterviewUpdate,
    AdminQuestionUpdate, AdminFeedbackUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()
security = HTTPBearer()


# ============================================================
# DEPENDENCY: verify the caller holds a valid ADMIN token
# ============================================================
def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("admin"):
        raise HTTPException(status_code=401, detail="Invalid or expired admin session")
    return payload


# ============================================================
# LOGIN
# ============================================================
@router.post("/admin/login", response_model=AdminToken)
async def admin_login(payload: AdminLogin):
    if not config.ADMIN_USERNAME or not config.ADMIN_PASSWORD_HASH:
        raise HTTPException(
            status_code=503,
            detail="Admin login is not configured on the server. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.",
        )

    valid_username = payload.username == config.ADMIN_USERNAME
    valid_password = verify_password(payload.password, config.ADMIN_PASSWORD_HASH)

    if not valid_username or not valid_password:
        logger.warning(f"Failed admin login attempt (username tried: {payload.username})")
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    token = create_access_token(
        data={"admin": True, "sub": payload.username},
        expires_delta=timedelta(minutes=config.ADMIN_TOKEN_EXPIRE_MINUTES),
    )
    logger.info("Admin logged in")
    return AdminToken(access_token=token)


# ============================================================
# DASHBOARD STATS
# ============================================================
@router.get("/admin/stats")
async def get_stats(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return {
        "total_users": db.query(User).count(),
        "total_interviews": db.query(Interview).count(),
        "completed_interviews": db.query(Interview).filter(Interview.status == "completed").count(),
        "verified_users": db.query(User).filter(User.is_verified == True).count(),  # noqa: E712
        "private_interviews": db.query(Interview).filter(Interview.sector == "private").count(),
        "government_interviews": db.query(Interview).filter(Interview.sector == "government").count(),
    }


@router.get("/admin/government-domains")
async def list_government_domains(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    """Distinct government_domain values in use, for building a category filter dropdown."""
    rows = (
        db.query(Interview.government_domain)
        .filter(Interview.sector == "government", Interview.government_domain.isnot(None))
        .distinct()
        .all()
    )
    return sorted({r[0] for r in rows if r[0]})


# ============================================================
# USERS — list / detail / update / delete
# ============================================================
@router.get("/admin/users")
async def list_users(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    users = db.query(User).order_by(User.id.desc()).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "is_verified": u.is_verified,
            "created_at": u.created_at,
            "interview_count": len(u.interviews),
        }
        for u in users
    ]


@router.get("/admin/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_verified": user.is_verified,
        "created_at": user.created_at,
        "interviews": [_serialize_interview(i, include_details=False) for i in user.interviews],
    }


@router.put("/admin/users/{user_id}")
async def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.email is not None and payload.email != user.email:
        clash = db.query(User).filter(User.email == payload.email, User.id != user_id).first()
        if clash:
            raise HTTPException(status_code=400, detail="Another account already uses that email")
        user.email = payload.email

    if payload.name is not None:
        user.name = payload.name
    if payload.is_verified is not None:
        user.is_verified = payload.is_verified
    if payload.new_password:
        if len(payload.new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        user.password_hash = hash_password(payload.new_password)

    db.commit()
    db.refresh(user)
    logger.info(f"Admin updated user {user.id}")
    return {"message": "User updated", "id": user.id}


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)  # cascades to interviews -> questions/feedback (see relationship() cascade config)
    db.commit()
    logger.info(f"Admin deleted user {user_id}")
    return {"message": "User and all related data deleted"}


# ============================================================
# INTERVIEWS — list / detail / update / delete
# ============================================================
def _serialize_interview(interview: Interview, include_details: bool = True) -> dict:
    data = {
        "id": interview.id,
        "user_id": interview.user_id,
        "role": interview.role,
        "difficulty": interview.difficulty,
        "status": interview.status,
        "overall_score": interview.overall_score,
        "started_at": interview.started_at,
        "completed_at": interview.completed_at,
        "sector": interview.sector,
        "government_domain": interview.government_domain,
        "government_role": interview.government_role,
        "candidate_summary": interview.candidate_summary,
    }
    if include_details:
        data["questions"] = [
            {
                "id": q.id,
                "question_text": q.question_text,
                "answer_text": q.answer_text,
                "order_index": q.order_index,
            }
            for q in sorted(interview.questions, key=lambda q: q.order_index)
        ]
        if interview.feedback:
            f = interview.feedback
            data["feedback"] = {
                "id": f.id,
                "overall_score": f.overall_score,
                "hiring_recommendation": f.hiring_recommendation,
                "summary": f.summary,
                "technical_score": f.technical_score,
                "soft_skills_score": f.soft_skills_score,
                "eye_contact_score": f.eye_contact_score,
                "confidence_score": f.confidence_score,
                "engagement_score": f.engagement_score,
                "strengths": f.strengths,
                "areas_to_improve": f.areas_to_improve,
                "next_steps": f.next_steps,
            }
        else:
            data["feedback"] = None
    return data


@router.get("/admin/interviews")
async def list_interviews(
    sector: Optional[str] = Query(None, description="Filter by 'private' or 'government'"),
    government_domain: Optional[str] = Query(None, description="Filter by domain, e.g. 'UPSC' (only with sector=government)"),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    query = db.query(Interview)
    if sector:
        query = query.filter(Interview.sector == sector)
    if government_domain:
        query = query.filter(Interview.government_domain == government_domain)
    interviews = query.order_by(Interview.id.desc()).all()
    return [_serialize_interview(i, include_details=False) for i in interviews]


@router.get("/admin/interviews/{interview_id}")
async def get_interview(interview_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return _serialize_interview(interview, include_details=True)


@router.put("/admin/interviews/{interview_id}")
async def update_interview(
    interview_id: int,
    payload: AdminInterviewUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(interview, field, value)

    db.commit()
    logger.info(f"Admin updated interview {interview_id}")
    return {"message": "Interview updated"}


@router.delete("/admin/interviews/{interview_id}")
async def delete_interview(interview_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    db.delete(interview)  # cascades to questions/feedback
    db.commit()
    logger.info(f"Admin deleted interview {interview_id}")
    return {"message": "Interview deleted"}


# ============================================================
# QUESTIONS — update / delete (created only via the interview flow)
# ============================================================
@router.put("/admin/questions/{question_id}")
async def update_question(
    question_id: int,
    payload: AdminQuestionUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    question = db.query(InterviewQuestion).filter(InterviewQuestion.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(question, field, value)

    db.commit()
    logger.info(f"Admin updated question {question_id}")
    return {"message": "Question updated"}


@router.delete("/admin/questions/{question_id}")
async def delete_question(question_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    question = db.query(InterviewQuestion).filter(InterviewQuestion.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    db.delete(question)
    db.commit()
    logger.info(f"Admin deleted question {question_id}")
    return {"message": "Question deleted"}


# ============================================================
# FEEDBACK — update / delete
# ============================================================
@router.put("/admin/feedback/{feedback_id}")
async def update_feedback(
    feedback_id: int,
    payload: AdminFeedbackUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(feedback, field, value)

    db.commit()
    logger.info(f"Admin updated feedback {feedback_id}")
    return {"message": "Feedback updated"}


@router.delete("/admin/feedback/{feedback_id}")
async def delete_feedback(feedback_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    db.delete(feedback)
    db.commit()
    logger.info(f"Admin deleted feedback {feedback_id}")
    return {"message": "Feedback deleted"}
