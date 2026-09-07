# ============================================================
# Leaderboard Routes
# File: routes/leaderboard.py
#
# Powers the "Leaderboard" tab (previously a comingSoon sidebar item —
# see js/sidebar.js). Ranks candidates by a composite HireView Score
# blended from whichever of the three practice modes they've actually
# used, so someone who has only done Aptitude tests isn't penalized
# for never having taken a mock Interview.
#
#   HireView Score = weighted avg of:
#     • Interview quality   (Feedback.overall_score, 0-10  -> x10)   weight 0.5
#     • Aptitude accuracy   (AptitudeAttempt.score_percent, 0-100)   weight 0.25
#     • Coding accuracy     (CodingAttempt.score_percent, 0-100)     weight 0.25
#   Weights are renormalized over only the components a user has data
#   for — no component present means no artificial zero dragging the
#   score down.
#
# Privacy: only first name + last-initial and aggregate numbers are
# ever returned — never email, never raw activity content.
# ============================================================

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from models.database import get_db, User, Interview, AptitudeAttempt, CodingAttempt
from routes.auth import get_current_user

router = APIRouter()

WEIGHTS = {"interview": 0.5, "aptitude": 0.25, "coding": 0.25}


def _display_name(full_name: str) -> str:
    parts = (full_name or "Candidate").strip().split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


def _period_cutoff(period: str) -> Optional[datetime]:
    if period == "month":
        now = datetime.utcnow()
        return datetime(now.year, now.month, 1)
    if period == "week":
        return datetime.utcnow() - timedelta(days=7)
    return None  # "all"


def _composite(interview_avg, aptitude_avg, coding_avg) -> Optional[float]:
    parts = []
    if interview_avg is not None:
        parts.append((interview_avg * 10, WEIGHTS["interview"]))
    if aptitude_avg is not None:
        parts.append((aptitude_avg, WEIGHTS["aptitude"]))
    if coding_avg is not None:
        parts.append((coding_avg, WEIGHTS["coding"]))
    if not parts:
        return None
    total_weight = sum(w for _, w in parts)
    return sum(v * w for v, w in parts) / total_weight


@router.get("/leaderboard")
async def get_leaderboard(
    period: str = Query("all", pattern="^(all|month|week)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cutoff = _period_cutoff(period)

    # ── Pull scored activity, grouped per user ──────────────
    iq = db.query(Interview.user_id, Interview.overall_score).filter(
        Interview.status == "completed", Interview.overall_score.isnot(None)
    )
    aq = db.query(AptitudeAttempt.user_id, AptitudeAttempt.score_percent).filter(
        AptitudeAttempt.status == "completed", AptitudeAttempt.score_percent.isnot(None)
    )
    cq = db.query(CodingAttempt.user_id, CodingAttempt.score_percent).filter(
        CodingAttempt.status == "completed", CodingAttempt.score_percent.isnot(None)
    )
    if cutoff:
        iq = iq.filter(Interview.completed_at >= cutoff)
        aq = aq.filter(AptitudeAttempt.completed_at >= cutoff)
        cq = cq.filter(CodingAttempt.completed_at >= cutoff)

    interview_scores = defaultdict(list)
    for uid, score in iq.all():
        interview_scores[uid].append(score)

    aptitude_scores = defaultdict(list)
    for uid, score in aq.all():
        aptitude_scores[uid].append(score)

    coding_scores = defaultdict(list)
    for uid, score in cq.all():
        coding_scores[uid].append(score)

    active_user_ids = set(interview_scores) | set(aptitude_scores) | set(coding_scores)
    if not active_user_ids:
        return {"period": period, "top": [], "you": None, "total_ranked_users": 0}

    users = {u.id: u for u in db.query(User).filter(User.id.in_(active_user_ids)).all()}

    rows = []
    for uid in active_user_ids:
        user = users.get(uid)
        if not user:
            continue
        interview_avg = mean(interview_scores[uid]) if interview_scores.get(uid) else None
        aptitude_avg = mean(aptitude_scores[uid]) if aptitude_scores.get(uid) else None
        coding_avg = mean(coding_scores[uid]) if coding_scores.get(uid) else None
        score = _composite(interview_avg, aptitude_avg, coding_avg)
        if score is None:
            continue
        rows.append({
            "user_id": uid,
            "display_name": _display_name(user.name),
            "score": round(score, 1),
            "total_interviews": len(interview_scores.get(uid, [])),
            "total_aptitude": len(aptitude_scores.get(uid, [])),
            "total_coding": len(coding_scores.get(uid, [])),
        })

    rows.sort(key=lambda r: -r["score"])
    for idx, r in enumerate(rows, start=1):
        r["rank"] = idx
        r["is_you"] = (r["user_id"] == current_user.id)

    you = next((r for r in rows if r["is_you"]), None)
    top = rows[:limit]

    # strip the raw user_id before sending to the browser — rank +
    # display_name + is_you is all the frontend needs
    for r in rows:
        r.pop("user_id", None)

    return {
        "period": period,
        "top": top,
        "you": you,
        "total_ranked_users": len(rows),
    }