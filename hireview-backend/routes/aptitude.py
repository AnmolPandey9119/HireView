# ============================================================
# Aptitude Test Routes
# File: routes/aptitude.py
#
# The actual test-taking engine that sits on top of the read-only
# question bank (routes/questions.py). A candidate:
#   1. POST /aptitude/start      -> gets a fresh set of N random MCQs
#   2. POST /aptitude/{id}/submit -> grades everything server-side,
#      saves the attempt, returns a full per-question review
#   3. GET  /aptitude/attempts    -> list of past attempts (My Reports)
#   4. GET  /aptitude/attempts/{id} -> full review of one past attempt
#
# Same rule as questions.py: correct_index/explanation are NEVER sent
# to the browser before grading — /start strips them, grading always
# happens here against the DB, and only /submit (or viewing an
# already-completed attempt) reveals them.
# ============================================================

import json
import random
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.database import get_db, QuestionBank, AptitudeAttempt, User, to_utc_iso
from routes.auth import get_current_user

router = APIRouter()


# ────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────
class StartAptitudeRequest(BaseModel):
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    count: int = 10


class AnswerItem(BaseModel):
    question_id: int
    selected_index: int


class SubmitAptitudeRequest(BaseModel):
    answers: List[AnswerItem]
    time_taken_seconds: int = 0


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────
def _question_public(q: QuestionBank) -> dict:
    """Question shape shown to the candidate WHILE taking the test —
    no correct_index, no explanation."""
    return {
        "id": q.id,
        "topic": q.topic,
        "difficulty": q.difficulty,
        "prompt": q.prompt,
        "options": json.loads(q.options) if q.options else [],
    }


def _attempt_summary(a: AptitudeAttempt) -> dict:
    return {
        "id": a.id,
        "topic": a.topic,
        "difficulty": a.difficulty,
        "total_questions": a.total_questions,
        "correct_count": a.correct_count,
        "score_percent": a.score_percent,
        "time_taken_seconds": a.time_taken_seconds,
        "status": a.status,
        "started_at": to_utc_iso(a.started_at),
        "completed_at": to_utc_iso(a.completed_at),
    }


def _build_review(a: AptitudeAttempt, db: Session) -> dict:
    """Full per-question breakdown for a completed attempt — used by both
    the submit response and the 'view past attempt' endpoint."""
    question_ids = json.loads(a.question_ids)
    saved_answers = json.loads(a.answers) if a.answers else {}

    questions_by_id = {
        q.id: q for q in db.query(QuestionBank).filter(QuestionBank.id.in_(question_ids)).all()
    }

    review = []
    for qid in question_ids:
        q = questions_by_id.get(qid)
        if not q:
            continue  # question was deleted/deactivated after this attempt was taken
        selected = saved_answers.get(str(qid))
        review.append({
            "id": q.id,
            "topic": q.topic,
            "difficulty": q.difficulty,
            "prompt": q.prompt,
            "options": json.loads(q.options) if q.options else [],
            "selected_index": selected,
            "correct_index": q.correct_index,
            "is_correct": selected is not None and selected == q.correct_index,
            "explanation": q.explanation,
        })

    return {**_attempt_summary(a), "questions": review}


# ────────────────────────────────────────────
# POST /aptitude/start
# ────────────────────────────────────────────
@router.post("/aptitude/start")
def start_aptitude_test(
    payload: StartAptitudeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count = max(1, min(payload.count or 10, 50))

    q = db.query(QuestionBank).filter(
        QuestionBank.category == "aptitude",
        QuestionBank.is_active == True,  # noqa: E712
    )
    if payload.topic:
        q = q.filter(QuestionBank.topic == payload.topic)
    if payload.difficulty:
        q = q.filter(QuestionBank.difficulty == payload.difficulty)

    pool = q.all()
    if not pool:
        raise HTTPException(status_code=404, detail="No aptitude questions available for that filter")

    chosen = random.sample(pool, k=min(count, len(pool)))

    attempt = AptitudeAttempt(
        user_id=current_user.id,
        topic=payload.topic,
        difficulty=payload.difficulty,
        question_ids=json.dumps([q.id for q in chosen]),
        total_questions=len(chosen),
        status="in_progress",
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    return {
        "attempt_id": attempt.id,
        "total_questions": len(chosen),
        "suggested_duration_seconds": len(chosen) * 45,  # 45s/question, matches frontend timer default
        "questions": [_question_public(x) for x in chosen],
    }


# ────────────────────────────────────────────
# POST /aptitude/{attempt_id}/submit
# ────────────────────────────────────────────
@router.post("/aptitude/{attempt_id}/submit")
def submit_aptitude_test(
    attempt_id: int,
    payload: SubmitAptitudeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempt = db.query(AptitudeAttempt).filter(
        AptitudeAttempt.id == attempt_id,
        AptitudeAttempt.user_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status == "completed":
        raise HTTPException(status_code=400, detail="This attempt was already submitted")

    question_ids = json.loads(attempt.question_ids)
    questions_by_id = {
        q.id: q for q in db.query(QuestionBank).filter(QuestionBank.id.in_(question_ids)).all()
    }

    # Only keep answers for questions that actually belong to this attempt —
    # ignores anything tampered with/extraneous in the request body.
    answers_map = {}
    correct_count = 0
    for item in payload.answers:
        if item.question_id not in questions_by_id:
            continue
        answers_map[str(item.question_id)] = item.selected_index
        if item.selected_index == questions_by_id[item.question_id].correct_index:
            correct_count += 1

    total = len(question_ids)
    attempt.answers = json.dumps(answers_map)
    attempt.correct_count = correct_count
    attempt.score_percent = round((correct_count / total) * 100, 1) if total else 0.0
    attempt.time_taken_seconds = max(0, payload.time_taken_seconds or 0)
    attempt.status = "completed"
    attempt.completed_at = datetime.utcnow()

    db.commit()
    db.refresh(attempt)

    return _build_review(attempt, db)


# ────────────────────────────────────────────
# GET /aptitude/attempts — for My Reports
# ────────────────────────────────────────────
@router.get("/aptitude/attempts")
def list_aptitude_attempts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempts = db.query(AptitudeAttempt).filter(
        AptitudeAttempt.user_id == current_user.id,
        AptitudeAttempt.status == "completed",
    ).order_by(AptitudeAttempt.completed_at.desc()).all()

    return {"count": len(attempts), "attempts": [_attempt_summary(a) for a in attempts]}


# ────────────────────────────────────────────
# GET /aptitude/attempts/{id} — full review of one past attempt
# ────────────────────────────────────────────
@router.get("/aptitude/attempts/{attempt_id}")
def get_aptitude_attempt(
    attempt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempt = db.query(AptitudeAttempt).filter(
        AptitudeAttempt.id == attempt_id,
        AptitudeAttempt.user_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status != "completed":
        raise HTTPException(status_code=400, detail="This attempt hasn't been submitted yet")

    return _build_review(attempt, db)