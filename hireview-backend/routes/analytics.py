# ============================================================
# Analytics Routes
# File: routes/analytics.py
#
# Powers the "Analytics" tab (previously a comingSoon sidebar item —
# see js/sidebar.js). Everything here is READ-ONLY aggregation over
# data that already exists from the Interview, Aptitude and Coding
# flows — no new tables, no new writes, nothing that touches a
# candidate's session while it's in progress.
#
# One endpoint, one payload: GET /api/analytics/summary. The frontend
# (js/analytics.js) renders it as stat cards + three charts (score
# trend, skill radar, aptitude topic breakdown) with Chart.js.
# ============================================================

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.database import (
    get_db, to_utc_iso, User, Interview, Feedback,
    AptitudeAttempt, CodingAttempt
)
from routes.auth import get_current_user

router = APIRouter()


def _round(v: Optional[float], nd: int = 1) -> Optional[float]:
    return round(v, nd) if v is not None else None


def _avg(values: List[float]) -> Optional[float]:
    values = [v for v in values if v is not None]
    return mean(values) if values else None


def _streak_days(activity_dates: List[datetime]) -> int:
    """Consecutive-day streak ending today or yesterday (so a candidate
    who practiced last night doesn't see their streak zero out at
    midnight before they've had a chance to practice today)."""
    if not activity_dates:
        return 0
    days = sorted({d.date() for d in activity_dates}, reverse=True)
    today = datetime.utcnow().date()
    if days[0] not in (today, today - timedelta(days=1)):
        return 0
    streak = 1
    for i in range(1, len(days)):
        if (days[i - 1] - days[i]).days == 1:
            streak += 1
        else:
            break
    return streak


@router.get("/analytics/summary")
async def get_analytics_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # ── Interviews + Feedback ──────────────────────────────
    interviews = (
        db.query(Interview)
        .filter(Interview.user_id == current_user.id, Interview.status == "completed")
        .order_by(Interview.completed_at.asc())
        .all()
    )
    feedback_by_interview = {
        f.interview_id: f
        for f in db.query(Feedback).filter(
            Feedback.interview_id.in_([i.id for i in interviews])
        ).all()
    } if interviews else {}

    overall_scores  = [i.overall_score for i in interviews if i.overall_score is not None]
    technical_scores, soft_scores = [], []
    eye_scores, conf_scores, eng_scores = [], [], []
    score_trend = []

    for i in interviews[-12:]:
        fb = feedback_by_interview.get(i.id)
        score_trend.append({
            "date": to_utc_iso(i.completed_at or i.started_at),
            "role": i.role,
            "overall": _round(i.overall_score),
            "technical": _round(fb.technical_score) if fb else None,
            "soft_skills": _round(fb.soft_skills_score) if fb else None,
        })

    for fb in feedback_by_interview.values():
        if fb.technical_score is not None:
            technical_scores.append(fb.technical_score)
        if fb.soft_skills_score is not None:
            soft_scores.append(fb.soft_skills_score)
        if fb.eye_contact_score is not None:
            eye_scores.append(fb.eye_contact_score)
        if fb.confidence_score is not None:
            conf_scores.append(fb.confidence_score)
        if fb.engagement_score is not None:
            eng_scores.append(fb.engagement_score)

    sector_breakdown = defaultdict(int)
    for i in interviews:
        sector_breakdown[i.sector or "private"] += 1

    # Computed here (not further down) because badge_defs below needs it —
    # keeping it next to overall_scores avoids the "used before defined"
    # bug this line originally had.
    my_avg = _avg(overall_scores)

    # ── Aptitude ────────────────────────────────────────────
    apt_attempts = (
        db.query(AptitudeAttempt)
        .filter(AptitudeAttempt.user_id == current_user.id, AptitudeAttempt.status == "completed")
        .order_by(AptitudeAttempt.completed_at.asc())
        .all()
    )
    apt_scores = [a.score_percent for a in apt_attempts if a.score_percent is not None]
    aptitude_trend = [
        {"date": to_utc_iso(a.completed_at or a.started_at), "score_percent": _round(a.score_percent)}
        for a in apt_attempts[-12:]
    ]
    topic_scores = defaultdict(list)
    for a in apt_attempts:
        if a.topic and a.score_percent is not None:
            topic_scores[a.topic].append(a.score_percent)
    aptitude_topic_breakdown = sorted(
        [
            {"topic": t, "avg_score_percent": _round(_avg(scores)), "attempts": len(scores)}
            for t, scores in topic_scores.items()
        ],
        key=lambda x: -x["attempts"]
    )[:8]

    # ── Coding ──────────────────────────────────────────────
    coding_attempts = (
        db.query(CodingAttempt)
        .filter(CodingAttempt.user_id == current_user.id, CodingAttempt.status == "completed")
        .order_by(CodingAttempt.completed_at.asc())
        .all()
    )
    coding_scores = [c.score_percent for c in coding_attempts if c.score_percent is not None]
    coding_trend = [
        {"date": to_utc_iso(c.completed_at or c.started_at), "score_percent": _round(c.score_percent)}
        for c in coding_attempts[-12:]
    ]
    total_coding_solved = sum(c.solved_count or 0 for c in coding_attempts)

    # ── Streak (any practice activity: interview / aptitude / coding) ──
    activity_dates = (
        [i.started_at for i in interviews] +
        [a.started_at for a in apt_attempts] +
        [c.started_at for c in coding_attempts]
    )
    streak = _streak_days(activity_dates)

    # ── Achievements / badges ──────────────────────────────
    # Pure computation over data already gathered above — no new table,
    # no extra query, zero added cost. Doubles as a free, unique
    # "gamification" layer competitors would normally need a whole
    # points-engine service for.
    total_sessions = len(interviews) + len(apt_attempts) + len(coding_attempts)
    has_all_three = bool(interviews) and bool(apt_attempts) and bool(coding_attempts)
    has_govt_interview = sector_breakdown.get("government", 0) > 0
    any_perfect_apt = any(s >= 100 for s in apt_scores)
    any_perfect_coding = any(s >= 100 for s in coding_scores)

    badge_defs = [
        {"id": "first_steps", "icon": "🎬", "label": "First Steps",
         "description": "Complete your first mock interview.",
         "earned": len(interviews) >= 1},
        {"id": "on_fire", "icon": "🔥", "label": "On Fire",
         "description": "Practice 3 days in a row.",
         "earned": streak >= 3},
        {"id": "unstoppable", "icon": "⚡", "label": "Unstoppable",
         "description": "Practice 7 days in a row.",
         "earned": streak >= 7},
        {"id": "aptitude_ace", "icon": "🧠", "label": "Aptitude Ace",
         "description": "Average 80%+ across 3 or more Aptitude Tests.",
         "earned": len(apt_scores) >= 3 and (_avg(apt_scores) or 0) >= 80},
        {"id": "code_warrior", "icon": "💻", "label": "Code Warrior",
         "description": "Solve 10 or more coding problems in total.",
         "earned": total_coding_solved >= 10},
        {"id": "perfect_score", "icon": "💯", "label": "Perfectionist",
         "description": "Score a perfect 100% on an Aptitude Test or Coding round.",
         "earned": any_perfect_apt or any_perfect_coding},
        {"id": "consistent_performer", "icon": "🎯", "label": "Consistent Performer",
         "description": "Average 8+/10 across all your completed interviews.",
         "earned": (my_avg or 0) >= 8 and len(overall_scores) >= 2},
        {"id": "government_ready", "icon": "🏛️", "label": "Government Ready",
         "description": "Complete a Government-sector mock interview.",
         "earned": has_govt_interview},
        {"id": "well_rounded", "icon": "🌟", "label": "Well Rounded",
         "description": "Try all three modes — Interview, Aptitude and Coding.",
         "earned": has_all_three},
        {"id": "dedicated_learner", "icon": "📚", "label": "Dedicated Learner",
         "description": "Complete 10 or more practice sessions of any kind.",
         "earned": total_sessions >= 10},
    ]
    badges_earned_count = sum(1 for b in badge_defs if b["earned"])

    # ── Percentile vs. other candidates (interview quality) ────
    percentile = None
    if my_avg is not None:
        rows = (
            db.query(Interview.user_id, Interview.overall_score)
            .filter(Interview.status == "completed", Interview.overall_score.isnot(None))
            .all()
        )
        per_user = defaultdict(list)
        for uid, score in rows:
            per_user[uid].append(score)
        peer_avgs = [mean(v) for v in per_user.values()]
        if len(peer_avgs) >= 1:
            lower_or_equal = sum(1 for v in peer_avgs if v <= my_avg)
            percentile = round(100 * lower_or_equal / len(peer_avgs))

    badge_defs.append({
        "id": "top_performer", "icon": "🥇", "label": "Top Performer",
        "description": "Land in the top 10% of interview scores platform-wide.",
        "earned": percentile is not None and percentile >= 90 and len(overall_scores) >= 2,
    })
    badges_earned_count = sum(1 for b in badge_defs if b["earned"])

    return {
        "overview": {
            "total_interviews": len(interviews),
            "completed_interviews": len(interviews),
            "avg_overall_score": _round(my_avg),
            "best_overall_score": _round(max(overall_scores)) if overall_scores else None,
            "avg_technical_score": _round(_avg(technical_scores)),
            "avg_soft_skills_score": _round(_avg(soft_scores)),
            "total_aptitude_attempts": len(apt_attempts),
            "avg_aptitude_score": _round(_avg(apt_scores)),
            "total_coding_attempts": len(coding_attempts),
            "avg_coding_score": _round(_avg(coding_scores)),
            "total_coding_solved": total_coding_solved,
            "current_streak_days": streak,
            "percentile": percentile,
            "badges_earned_count": badges_earned_count,
            "badges_total_count": len(badge_defs),
        },
        "badges": badge_defs,
        "score_trend": score_trend,
        "skill_radar": {
            "technical": _round(_avg(technical_scores)) or 0,
            "soft_skills": _round(_avg(soft_scores)) or 0,
            "eye_contact": _round(_avg(eye_scores)) or 0,
            "confidence": _round(_avg(conf_scores)) or 0,
            "engagement": _round(_avg(eng_scores)) or 0,
        },
        "aptitude_trend": aptitude_trend,
        "coding_trend": coding_trend,
        "aptitude_topic_breakdown": aptitude_topic_breakdown,
        "sector_breakdown": dict(sector_breakdown),
        "has_any_activity": bool(interviews or apt_attempts or coding_attempts),
    }