# ============================================================
# Question Bank Routes
# File: routes/questions.py
#
# Read-only endpoints for the question bank built in Phase 1.
# Later phases (3: aptitude test engine, 4: coding round) will call
# these to pull question sets — this file itself doesn't run any
# tests or grade anything, it only serves question data.
#
# All endpoints require login (get_current_user) — question bank
# access is a logged-in-user feature, not public.
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import random

from models.database import get_db, QuestionBank, CodingTestCase
from routes.auth import get_current_user
from models.database import User

router = APIRouter()


class AnswerSubmission(BaseModel):
    selected_index: int


def _serialize_question(q: QuestionBank, include_answer: bool = False) -> dict:
    """Shared serializer. include_answer=False strips the correct_index/
    explanation/non-sample test cases so a candidate can't just read the
    answer out of the API response while taking a test. Set True only for
    admin/review use, never for the live test-taking flow."""
    data = {
        "id": q.id,
        "category": q.category,
        "topic": q.topic,
        "difficulty": q.difficulty,
        "prompt": q.prompt,
    }

    if q.category == "aptitude":
        data["options"] = json.loads(q.options) if q.options else []
        if include_answer:
            data["correct_index"] = q.correct_index
            data["explanation"] = q.explanation

    elif q.category == "coding":
        data["starter_code"] = q.starter_code
        data["constraints"] = q.constraints
        sample_cases = [tc for tc in q.test_cases if tc.is_sample]
        data["sample_test_cases"] = [
            {"input": tc.input, "expected_output": tc.expected_output}
            for tc in sorted(sample_cases, key=lambda t: t.order_index)
        ]
        if include_answer:
            data["all_test_cases"] = [
                {"input": tc.input, "expected_output": tc.expected_output, "is_sample": tc.is_sample}
                for tc in sorted(q.test_cases, key=lambda t: t.order_index)
            ]

    elif q.category == "interview":
        if include_answer:
            data["guidance_notes"] = q.guidance_notes

    return data


@router.get("/questions")
def list_questions(
    category: str = Query(..., description="'aptitude' | 'coding' | 'interview'"),
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    limit: int = Query(50, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List questions in a category, optionally filtered by topic/difficulty.
    Answers/explanations are never included here — this is the browsing/
    practice-selection view, not the grading view."""
    if category not in ("aptitude", "coding", "interview"):
        raise HTTPException(status_code=400, detail="category must be aptitude, coding, or interview")

    q = db.query(QuestionBank).filter(
        QuestionBank.category == category,
        QuestionBank.is_active == True,  # noqa: E712 — SQLAlchemy needs == not `is`
    )
    if topic:
        q = q.filter(QuestionBank.topic == topic)
    if difficulty:
        q = q.filter(QuestionBank.difficulty == difficulty)

    questions = q.limit(limit).all()
    return {"count": len(questions), "questions": [_serialize_question(x) for x in questions]}


@router.get("/questions/topics")
def list_topics(
    category: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Distinct topics available in a category, with a per-difficulty count —
    drives the topic-picker UI in Phase 3 (aptitude) / Phase 4 (coding)."""
    if category not in ("aptitude", "coding", "interview"):
        raise HTTPException(status_code=400, detail="category must be aptitude, coding, or interview")

    rows = db.query(QuestionBank.topic, QuestionBank.difficulty).filter(
        QuestionBank.category == category,
        QuestionBank.is_active == True,  # noqa: E712
    ).all()

    topics: dict[str, dict[str, int]] = {}
    for topic, difficulty in rows:
        topics.setdefault(topic, {"easy": 0, "medium": 0, "hard": 0})
        topics[topic][difficulty] = topics[topic].get(difficulty, 0) + 1

    return {"topics": topics}


@router.get("/questions/{question_id}")
def get_question(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full detail for a single question (still answer-free) — used when a
    candidate opens one specific question to attempt it."""
    q = db.query(QuestionBank).filter(QuestionBank.id == question_id, QuestionBank.is_active == True).first()  # noqa: E712
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return _serialize_question(q)


@router.get("/questions/random-set")
def get_random_set(
    category: str = Query(...),
    difficulty: Optional[str] = None,
    count: int = Query(10, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pull a random N questions from a category (optionally locked to one
    difficulty) — this is what Phase 3's aptitude test runner and Phase 4's
    coding round will call to assemble an actual test/session."""
    if category not in ("aptitude", "coding", "interview"):
        raise HTTPException(status_code=400, detail="category must be aptitude, coding, or interview")

    q = db.query(QuestionBank).filter(
        QuestionBank.category == category,
        QuestionBank.is_active == True,  # noqa: E712
    )
    if difficulty:
        q = q.filter(QuestionBank.difficulty == difficulty)

    pool = q.all()
    if not pool:
        raise HTTPException(status_code=404, detail="No questions available for that filter")

    chosen = random.sample(pool, k=min(count, len(pool)))
    return {"count": len(chosen), "questions": [_serialize_question(x) for x in chosen]}


@router.post("/questions/{question_id}/answer")
def submit_answer(
    question_id: int,
    body: AnswerSubmission,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grade one aptitude MCQ answer server-side. This is the ONLY place
    correct_index/explanation ever leave the backend for a question the
    candidate hasn't finished attempting yet — list_questions/get_question
    never include them, by design (see _serialize_question). Doing the
    check here means the answer key never sits in a browser JS payload
    where devtools could read it before the candidate submits."""
    q = db.query(QuestionBank).filter(QuestionBank.id == question_id, QuestionBank.is_active == True).first()  # noqa: E712
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if q.category != "aptitude":
        raise HTTPException(status_code=400, detail="Only aptitude questions are auto-graded here")

    is_correct = body.selected_index == q.correct_index
    return {
        "is_correct": is_correct,
        "correct_index": q.correct_index,
        "explanation": q.explanation,
    }