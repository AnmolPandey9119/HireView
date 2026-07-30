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
from datetime import timedelta, datetime
from typing import Optional
import logging

import config
from models.database import get_db, User, Interview, InterviewQuestion, Feedback, SiteVisit, Transaction
from models.auth_utils import (
    hash_password, verify_password, create_access_token, decode_access_token,
    validate_password_strength,
)
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
    visit_row = db.query(SiteVisit).first()
    return {
        "total_users": db.query(User).count(),
        "total_interviews": db.query(Interview).count(),
        "completed_interviews": db.query(Interview).filter(Interview.status == "completed").count(),
        "verified_users": db.query(User).filter(User.is_verified == True).count(),  # noqa: E712
        "premium_users": db.query(User).filter(User.subscription_active_until > datetime.utcnow()).count(),
        "private_interviews": db.query(Interview).filter(Interview.sector == "private").count(),
        "government_interviews": db.query(Interview).filter(Interview.sector == "government").count(),
        "total_visitors": visit_row.total_visits if visit_row else 0,
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
def _user_serial_map(db: Session) -> dict:
    """Maps real user.id -> stable 1,2,3... serial number, oldest-first.

    Computed fresh on every request (not stored in the DB), so when a user
    is deleted, everyone registered after them automatically shifts up by
    one the next time this is computed. This is the SAME numbering shown
    as `serial_no` in the Users tab, so it can be reused anywhere a user
    needs to be referenced by a human-friendly, gap-free number (e.g. the
    "User S.No." column on the Interviews tab) instead of the raw,
    permanent database primary key.
    """
    users = db.query(User).order_by(User.id.asc()).all()
    return {u.id: idx for idx, u in enumerate(users, start=1)}


def _interview_serial_map(db: Session) -> dict:
    """Maps real interview.id -> stable 1,2,3... serial number, oldest-first.

    Same idea as `_user_serial_map`, but for interviews. It's computed over
    ALL interviews (ignoring any sector/domain filter) so a given
    interview's serial number stays the same no matter how the list is
    currently filtered or sorted for display.
    """
    interviews = db.query(Interview).order_by(Interview.id.asc()).all()
    return {i.id: idx for idx, i in enumerate(interviews, start=1)}


def _latest_transaction_map(db: Session) -> dict:
    """user_id -> that user's most recent Transaction row.

    One query for the whole user list, instead of a per-user query in a
    loop — same batching pattern as _user_serial_map/_interview_serial_map
    above.
    """
    txns = db.query(Transaction).order_by(Transaction.created_at.desc()).all()
    latest = {}
    for t in txns:
        if t.user_id not in latest:  # first time we see this user = most recent, since already sorted desc
            latest[t.user_id] = t
    return latest


def _membership_info(user: User, latest_txn: Transaction = None) -> dict:
    """Derives current membership status from subscription_plan/subscription_active_until,
    plus when the current/most recent plan was actually purchased (from Transaction).

    membership_status is one of:
      "active"  — subscription_plan is set AND subscription_active_until is in the future
      "expired" — subscription_plan is set but subscription_active_until has passed
                  (someone who WAS a paying member, distinct from someone who never paid)
      "never"   — subscription_plan was never set at all

    "active" only requires BOTH a plan AND a still-future active_until — mirrors
    the same check the public dashboard uses to decide whether to show the gold crown.
    """
    is_active = bool(
        user.subscription_plan
        and user.subscription_active_until
        and user.subscription_active_until > datetime.utcnow()
    )

    if user.subscription_plan and user.subscription_active_until:
        membership_status = "active" if is_active else "expired"
    else:
        membership_status = "never"

    return {
        "is_premium": is_active,
        "membership_status": membership_status,
        "subscription_plan": user.subscription_plan,
        "subscription_active_until": user.subscription_active_until,
        # When the current (or most recently held) plan was actually
        # bought — each purchase resets active_until to "now + plan days"
        # at the moment of payment, so the latest transaction's
        # created_at IS the start of the current/last active window.
        "membership_started_at": latest_txn.created_at if latest_txn else None,
    }


@router.get("/admin/users")
async def list_users(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    # Ordered oldest-first so serial_no reflects registration order: 1, 2, 3, ...
    # `id` (the real, permanent database primary key) is kept separate and
    # unchanged — it's what edit/delete actions actually use under the hood.
    users = db.query(User).order_by(User.id.asc()).all()
    latest_txns = _latest_transaction_map(db)
    return [
        {
            "serial_no": idx,
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "is_verified": u.is_verified,
            "created_at": u.created_at,
            "interview_count": len(u.interviews),
            **_membership_info(u, latest_txns.get(u.id)),
        }
        for idx, u in enumerate(users, start=1)
    ]


@router.get("/admin/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    interview_serial_map = _interview_serial_map(db)
    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.created_at.desc())
        .all()
    )

    return {
        "id": user.id,
        "serial_no": _user_serial_map(db).get(user.id),
        "name": user.name,
        "email": user.email,
        "is_verified": user.is_verified,
        "created_at": user.created_at,
        **_membership_info(user, transactions[0] if transactions else None),
        "transactions": [
            {
                "id": t.id,
                "plan": t.plan,
                "amount_paise": t.amount_paise,
                "currency": t.currency,
                "status": t.status,
                "active_until": t.active_until,
                "created_at": t.created_at,
                "razorpay_payment_id": t.razorpay_payment_id,
            }
            for t in transactions
        ],
        "interviews": [
            _serialize_interview(i, include_details=False, serial_no=interview_serial_map.get(i.id))
            for i in user.interviews
        ],
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
        is_valid, error = validate_password_strength(payload.new_password)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error)
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
def _serialize_interview(
    interview: Interview,
    include_details: bool = True,
    serial_no: Optional[int] = None,
    user_serial_no: Optional[int] = None,
) -> dict:
    data = {
        "id": interview.id,
        "serial_no": serial_no,
        "user_id": interview.user_id,
        "user_serial_no": user_serial_no,
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

    # Built over the FULL unfiltered table so a given interview keeps the
    # same serial number regardless of which sector/domain filter is applied.
    interview_serial_map = _interview_serial_map(db)
    user_serial_map = _user_serial_map(db)

    return [
        _serialize_interview(
            i,
            include_details=False,
            serial_no=interview_serial_map.get(i.id),
            user_serial_no=user_serial_map.get(i.user_id),
        )
        for i in interviews
    ]


@router.get("/admin/interviews/{interview_id}")
async def get_interview(interview_id: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return _serialize_interview(
        interview,
        include_details=True,
        serial_no=_interview_serial_map(db).get(interview.id),
        user_serial_no=_user_serial_map(db).get(interview.user_id),
    )


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