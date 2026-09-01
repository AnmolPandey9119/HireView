# ============================================================
# Coding Round Routes
# File: routes/coding.py
#
# The in-browser compiler/grader promised on the Question Bank's
# coding tab ("coming in the next Coding Round update"). Sits on top
# of the same QuestionBank/CodingTestCase tables questions.py already
# reads — this file adds the part that was missing: actually running
# the candidate's code (via Piston, see models/piston_client.py) and
# grading it against each test case.
#
# Two ways this gets used:
#   1. Question Bank practice — POST /coding/questions/{id}/run and
#      /submit directly, no attempt_id. One-off, ungraded-round.
#   2. Coding Round session — POST /coding/start picks a set of
#      questions (mirrors /aptitude/start), the candidate solves each
#      one with the same /run + /submit endpoints (passing attempt_id),
#      then POST /coding/{attempt_id}/finish aggregates the round.
#
# Test-case answers (expected_output for HIDDEN cases) are never sent
# to the browser — same rule as aptitude's correct_index/explanation.
# Sample case expected_output IS shown (it's shown up-front on the
# question already, via /api/questions), so echoing it back in a
# result is not a new leak.
# ============================================================

import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import config
from models.database import (
    get_db, QuestionBank, CodingTestCase, CodingAttempt, CodingSubmission,
    User, to_utc_iso,
)
from models.piston_client import (
    LANGUAGES, LANGUAGES_BY_ID, PistonError, execute_code, normalize_output, get_starter_code,
)
from routes.auth import get_current_user
import random

router = APIRouter()


# ────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────
class StartCodingRoundRequest(BaseModel):
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    count: int = 5


class RunCodeRequest(BaseModel):
    language: str
    source_code: str = Field(..., max_length=config.MAX_SOURCE_CODE_CHARS)


class SubmitCodeRequest(BaseModel):
    language: str
    source_code: str = Field(..., max_length=config.MAX_SOURCE_CODE_CHARS)
    attempt_id: Optional[int] = None
    time_taken_seconds: int = 0


class FinishCodingRoundRequest(BaseModel):
    time_taken_seconds: int = 0


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────
def _question_public(q: QuestionBank) -> dict:
    """Question shape for the Coding Round question list — no hidden
    test cases, just the prompt/constraints/sample cases (same fields
    _serialize_question in questions.py exposes for a coding question)."""
    sample_cases = [tc for tc in q.test_cases if tc.is_sample]
    return {
        "id": q.id,
        "topic": q.topic,
        "difficulty": q.difficulty,
        "prompt": q.prompt,
        "constraints": q.constraints,
        "sample_test_cases": [
            {"input": tc.input, "expected_output": tc.expected_output}
            for tc in sorted(sample_cases, key=lambda t: t.order_index)
        ],
    }


def _get_question_or_404(db: Session, question_id: int) -> QuestionBank:
    q = db.query(QuestionBank).filter(
        QuestionBank.id == question_id,
        QuestionBank.category == "coding",
        QuestionBank.is_active == True,  # noqa: E712
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="Coding question not found")
    return q


def _run_against_cases(language: str, source_code: str, cases: List[CodingTestCase]) -> dict:
    """Runs source_code against every case in `cases`, stopping early (and
    marking every case as failed) if compilation fails — no point burning
    API calls re-compiling the same broken code once per test case."""
    results = []
    passed_count = 0
    compile_error = None

    for i, tc in enumerate(sorted(cases, key=lambda t: t.order_index)):
        if compile_error is not None:
            results.append({
                "is_sample": tc.is_sample,
                "input": tc.input if tc.is_sample else None,
                "expected_output": tc.expected_output if tc.is_sample else None,
                "actual_output": "",
                "passed": False,
                "error": "Compilation failed — see compile_error.",
            })
            continue

        try:
            outcome = execute_code(language, source_code, tc.input)
        except PistonError as e:
            raise HTTPException(status_code=503, detail=str(e))

        if outcome["compile_stderr"]:
            compile_error = outcome["compile_stderr"]
            results.append({
                "is_sample": tc.is_sample,
                "input": tc.input if tc.is_sample else None,
                "expected_output": tc.expected_output if tc.is_sample else None,
                "actual_output": "",
                "passed": False,
                "error": "Compilation failed — see compile_error.",
            })
            continue

        actual = outcome["stdout"]
        passed = normalize_output(actual) == normalize_output(tc.expected_output)
        if passed:
            passed_count += 1

        error = None
        if outcome["timed_out"]:
            error = "Time limit exceeded — your program took too long (possible infinite loop)."
        elif outcome["exit_code"] not in (0, None):
            error = (outcome["stderr"] or "Program exited with an error.").strip()[:2000]

        results.append({
            "is_sample": tc.is_sample,
            "input": tc.input if tc.is_sample else None,
            "expected_output": tc.expected_output if tc.is_sample else None,
            "actual_output": actual[:2000],
            "passed": passed,
            "error": error,
        })

    return {
        "results": results,
        "passed_count": passed_count,
        "total_count": len(cases),
        "compile_error": compile_error,
    }


# ────────────────────────────────────────────
# GET /coding/languages
# ────────────────────────────────────────────
@router.get("/coding/languages")
def list_languages(current_user: User = Depends(get_current_user)):
    return {
        "languages": [
            {"id": l["id"], "label": l["label"], "monaco_language": l["monaco_language"]}
            for l in LANGUAGES
        ]
    }


# ────────────────────────────────────────────
# GET /coding/questions/{id}/starter?language=python
# ────────────────────────────────────────────
@router.get("/coding/questions/{question_id}/starter")
def get_starter(
    question_id: int,
    language: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if language not in LANGUAGES_BY_ID:
        raise HTTPException(status_code=400, detail="Unsupported language")
    q = _get_question_or_404(db, question_id)
    return {"starter_code": get_starter_code(language, q.starter_code)}


# ────────────────────────────────────────────
# POST /coding/questions/{id}/run — sample cases only, not saved
# ────────────────────────────────────────────
@router.post("/coding/questions/{question_id}/run")
def run_code(
    question_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.language not in LANGUAGES_BY_ID:
        raise HTTPException(status_code=400, detail="Unsupported language")

    q = _get_question_or_404(db, question_id)
    sample_cases = [tc for tc in q.test_cases if tc.is_sample]
    if not sample_cases:
        raise HTTPException(status_code=400, detail="This question has no sample test cases to run against")

    outcome = _run_against_cases(payload.language, payload.source_code, sample_cases)
    return outcome


# ────────────────────────────────────────────
# POST /coding/questions/{id}/submit — full grading, saved
# ────────────────────────────────────────────
@router.post("/coding/questions/{question_id}/submit")
def submit_code(
    question_id: int,
    payload: SubmitCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.language not in LANGUAGES_BY_ID:
        raise HTTPException(status_code=400, detail="Unsupported language")

    q = _get_question_or_404(db, question_id)
    all_cases = list(q.test_cases)
    if not all_cases:
        raise HTTPException(status_code=400, detail="This question has no test cases configured")

    # If submitting inside a Coding Round, make sure the round belongs to
    # this user, is still open, and actually includes this question —
    # mirrors the tamper-protection aptitude's /submit does.
    attempt = None
    if payload.attempt_id is not None:
        attempt = db.query(CodingAttempt).filter(
            CodingAttempt.id == payload.attempt_id,
            CodingAttempt.user_id == current_user.id,
        ).first()
        if not attempt:
            raise HTTPException(status_code=404, detail="Coding round attempt not found")
        if attempt.status == "completed":
            raise HTTPException(status_code=400, detail="This coding round was already finished")
        if question_id not in json.loads(attempt.question_ids):
            raise HTTPException(status_code=400, detail="This question isn't part of that coding round")

    outcome = _run_against_cases(payload.language, payload.source_code, all_cases)

    submission = CodingSubmission(
        attempt_id=payload.attempt_id,
        user_id=current_user.id,
        question_id=question_id,
        language=payload.language,
        source_code=payload.source_code,
        passed_count=outcome["passed_count"],
        total_count=outcome["total_count"],
        is_solved=(outcome["total_count"] > 0 and outcome["passed_count"] == outcome["total_count"]),
        test_results=json.dumps(outcome["results"]),
        compile_error=outcome["compile_error"],
        time_taken_seconds=max(0, payload.time_taken_seconds or 0),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    return {
        "submission_id": submission.id,
        "passed_count": submission.passed_count,
        "total_count": submission.total_count,
        "is_solved": submission.is_solved,
        "compile_error": submission.compile_error,
        "results": outcome["results"],
    }


# ────────────────────────────────────────────
# POST /coding/start — begin a Coding Round session
# ────────────────────────────────────────────
@router.post("/coding/start")
def start_coding_round(
    payload: StartCodingRoundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count = max(1, min(payload.count or 5, 15))

    q = db.query(QuestionBank).filter(
        QuestionBank.category == "coding",
        QuestionBank.is_active == True,  # noqa: E712
    )
    if payload.topic:
        q = q.filter(QuestionBank.topic == payload.topic)
    if payload.difficulty:
        q = q.filter(QuestionBank.difficulty == payload.difficulty)

    pool = q.all()
    if not pool:
        raise HTTPException(status_code=404, detail="No coding questions available for that filter")

    chosen = random.sample(pool, k=min(count, len(pool)))

    attempt = CodingAttempt(
        user_id=current_user.id,
        topic=payload.topic,
        difficulty=payload.difficulty,
        question_ids=json.dumps([x.id for x in chosen]),
        total_questions=len(chosen),
        status="in_progress",
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    return {
        "attempt_id": attempt.id,
        "total_questions": len(chosen),
        "languages": [{"id": l["id"], "label": l["label"], "monaco_language": l["monaco_language"]} for l in LANGUAGES],
        "questions": [_question_public(x) for x in chosen],
    }


# ────────────────────────────────────────────
# POST /coding/{attempt_id}/finish
# ────────────────────────────────────────────
@router.post("/coding/{attempt_id}/finish")
def finish_coding_round(
    attempt_id: int,
    payload: FinishCodingRoundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempt = db.query(CodingAttempt).filter(
        CodingAttempt.id == attempt_id,
        CodingAttempt.user_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Coding round attempt not found")
    if attempt.status == "completed":
        raise HTTPException(status_code=400, detail="This coding round was already finished")

    question_ids = json.loads(attempt.question_ids)

    # For each question in the round, take the candidate's LATEST
    # submission (they may have submitted more than once while solving).
    solved_count = 0
    total_ratio = 0.0
    for qid in question_ids:
        latest = db.query(CodingSubmission).filter(
            CodingSubmission.attempt_id == attempt_id,
            CodingSubmission.question_id == qid,
        ).order_by(CodingSubmission.created_at.desc()).first()
        if latest:
            if latest.is_solved:
                solved_count += 1
            if latest.total_count:
                total_ratio += latest.passed_count / latest.total_count
        # unattempted questions contribute 0 to total_ratio, same as a
        # skipped aptitude question scoring 0 — no special-casing needed.

    attempt.solved_count = solved_count
    attempt.score_percent = round((total_ratio / len(question_ids)) * 100, 1) if question_ids else 0.0
    attempt.time_taken_seconds = max(0, payload.time_taken_seconds or 0)
    attempt.status = "completed"
    attempt.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(attempt)

    return _attempt_review(attempt, db)


def _attempt_summary(a: CodingAttempt) -> dict:
    return {
        "id": a.id,
        "topic": a.topic,
        "difficulty": a.difficulty,
        "total_questions": a.total_questions,
        "solved_count": a.solved_count,
        "score_percent": a.score_percent,
        "time_taken_seconds": a.time_taken_seconds,
        "status": a.status,
        "started_at": to_utc_iso(a.started_at),
        "completed_at": to_utc_iso(a.completed_at),
    }


def _attempt_review(a: CodingAttempt, db: Session) -> dict:
    question_ids = json.loads(a.question_ids)
    questions_by_id = {
        q.id: q for q in db.query(QuestionBank).filter(QuestionBank.id.in_(question_ids)).all()
    }

    questions = []
    for qid in question_ids:
        q = questions_by_id.get(qid)
        if not q:
            continue
        latest = db.query(CodingSubmission).filter(
            CodingSubmission.attempt_id == a.id,
            CodingSubmission.question_id == qid,
        ).order_by(CodingSubmission.created_at.desc()).first()

        questions.append({
            "id": q.id,
            "topic": q.topic,
            "difficulty": q.difficulty,
            "prompt": q.prompt,
            "attempted": latest is not None,
            "language": latest.language if latest else None,
            "source_code": latest.source_code if latest else None,
            "passed_count": latest.passed_count if latest else 0,
            "total_count": latest.total_count if latest else 0,
            "is_solved": latest.is_solved if latest else False,
        })

    return {**_attempt_summary(a), "questions": questions}


# ────────────────────────────────────────────
# GET /coding/attempts — for My Reports
# ────────────────────────────────────────────
@router.get("/coding/attempts")
def list_coding_attempts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempts = db.query(CodingAttempt).filter(
        CodingAttempt.user_id == current_user.id,
        CodingAttempt.status == "completed",
    ).order_by(CodingAttempt.completed_at.desc()).all()

    return {"count": len(attempts), "attempts": [_attempt_summary(a) for a in attempts]}


# ────────────────────────────────────────────
# GET /coding/attempts/{id} — full review of one past round
# ────────────────────────────────────────────
@router.get("/coding/attempts/{attempt_id}")
def get_coding_attempt(
    attempt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempt = db.query(CodingAttempt).filter(
        CodingAttempt.id == attempt_id,
        CodingAttempt.user_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status != "completed":
        raise HTTPException(status_code=400, detail="This coding round hasn't been finished yet")

    return _attempt_review(attempt, db)