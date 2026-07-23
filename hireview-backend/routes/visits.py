# ============================================================
# Visit Counter Routes
# File: routes/visits.py
#
# Two PUBLIC endpoints (no auth — this is a simple, low-stakes
# counter, not sensitive data) backing the "total visitors" number
# shown in the site footer and mirrored in the admin Overview tab:
#
#   POST /api/visits/track  -> increments the counter by 1
#   GET  /api/visits/count  -> reads the current total (no increment)
#
# Counting model: the frontend calls /track once per browser (it
# guards this with a localStorage flag), so this approximates
# "unique visitors per browser" rather than "total page views".
# Clearing site data or visiting from a new browser/device counts
# as a new visitor — there's no cookie/IP fingerprinting involved.
# ============================================================

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.database import get_db, SiteVisit

router = APIRouter()


def _get_or_create_row(db: Session) -> SiteVisit:
    """There is only ever one row in this table. Create it lazily
    on first use so no separate migration/seed step is needed."""
    row = db.query(SiteVisit).first()
    if not row:
        row = SiteVisit(total_visits=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.post("/visits/track")
async def track_visit(db: Session = Depends(get_db)):
    row = _get_or_create_row(db)
    # Atomic UPDATE (rather than read-modify-write in Python) so two
    # visitors hitting this at the same moment can't overwrite each
    # other's increment.
    db.execute(
        text("UPDATE site_visits SET total_visits = total_visits + 1 WHERE id = :id"),
        {"id": row.id},
    )
    db.commit()
    db.refresh(row)
    return {"total_visits": row.total_visits}


@router.get("/visits/count")
async def get_visit_count(db: Session = Depends(get_db)):
    row = _get_or_create_row(db)
    return {"total_visits": row.total_visits}