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
#
# CACHING: the full ranking (across every user, three tables) is
# recomputed from scratch on every call, which is fine at today's scale
# but would mean every open tab hammers the DB with the same expensive
# aggregation as the site grows. Same fix pattern already used by
# models/rate_limiter.py for the same reason (single Render instance,
# no Redis budget): a small in-memory TTL cache. Rankings staying up to
# 90 seconds stale is invisible to users and cuts DB load enormously
# under real traffic. If this service is ever scaled to multiple
# instances, this in-memory cache — like rate_limiter.py — would need
# to move to a shared store (Redis) to stay consistent across them.
# ============================================================

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean
from threading import Lock
from typing import Optional
import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from models.database import get_db, User, Interview, AptitudeAttempt, CodingAttempt
from routes.auth import get_current_user

router = APIRouter()

WEIGHTS = {"interview": 0.5, "aptitude": 0.25, "coding": 0.25}

_CACHE_TTL_SECONDS = 90
_cache_lock = Lock()
_cache: dict = {}   # period -> (computed_at, ranked_rows)


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


def _compute_rankings(db: Session, period: str) -> list:
    """The expensive part — pulls every scored activity across every
    user for the given period and returns a fully ranked list (each
    row still carries its raw user_id; the endpoint below strips that
    before sending anything to the browser). Cached by _get_rankings_cached."""
    cutoff = _period_cutoff(period)

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
        return []

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

    return rows


def _get_rankings_cached(db: Session, period: str) -> list:
    now = time.time()
    with _cache_lock:
        cached = _cache.get(period)
        if cached and (now - cached[0]) < _CACHE_TTL_SECONDS:
            return cached[1]
    rows = _compute_rankings(db, period)
    with _cache_lock:
        _cache[period] = (now, rows)
    return rows


@router.get("/leaderboard")
async def get_leaderboard(
    period: str = Query("all", pattern="^(all|month|week)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rows = _get_rankings_cached(db, period)
    if not rows:
        return {"period": period, "top": [], "you": None, "total_ranked_users": 0}

    you_row = next((r for r in rows if r["user_id"] == current_user.id), None)

    def _public(r: dict) -> dict:
        public = {k: v for k, v in r.items() if k != "user_id"}
        public["is_you"] = (r["user_id"] == current_user.id)
        return public

    return {
        "period": period,
        "top": [_public(r) for r in rows[:limit]],
        "you": _public(you_row) if you_row else None,
        "total_ranked_users": len(rows),
    }