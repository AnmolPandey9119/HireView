# ============================================================
# Database Models
# File: models/database.py
# Defines all tables: Users, Interviews, Resumes, Feedback
# ============================================================

from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, ForeignKey, Boolean, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, timezone

import config


def to_utc_iso(dt):
    """Serializes a datetime to an ISO string the browser will parse correctly.

    Every timestamp in this app is stored via datetime.utcnow(), which
    returns a "naive" datetime (no timezone attached) that nonetheless
    represents UTC. Calling .isoformat() on that directly produces a string
    like "2026-07-30T05:49:12" with no "Z"/offset — JavaScript's Date parser
    then treats a string like that as LOCAL time instead of UTC, so it never
    gets shifted to the viewer's actual timezone (e.g. IST) and the raw UTC
    value gets displayed as-is. Attaching tzinfo=utc before formatting fixes
    that: the string becomes "...T05:49:12+00:00", which every JS Date
    parser correctly converts to the browser's local time.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

# ============================================================
# DATABASE SETUP
# ============================================================
# SQLite needs check_same_thread=False; Postgres (Neon) doesn't
# accept that arg at all, so only pass it when actually on SQLite.
connect_args = {"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    config.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,   # avoids stale-connection errors after Neon auto-suspends
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ============================================================
# USER TABLE
# ============================================================
class User(Base):
    __tablename__ = "users"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    email            = Column(String, unique=True, index=True, nullable=False)
    password_hash    = Column(String, nullable=False)
    is_verified      = Column(Boolean, default=False, nullable=False)
    # Stored as a base64 data URL (e.g. "data:image/jpeg;base64,...").
    # Frontend resizes/compresses before upload — see MAX_PROFILE_PICTURE_BYTES
    # in config.py for the enforced size cap.
    profile_picture  = Column(Text, nullable=True)

    # Subscription tracking (see HireView Pricing Plan Proposal — Weekly ₹99
    # / Monthly ₹299, unlimited access, one-time pass, no auto-renewal).
    # No purchase endpoint exists yet — these are set manually / by a future
    # payment-gateway webhook once checkout is wired up. "plan" is 'weekly'
    # or 'monthly'; access is valid up to (and hard-cuts off at) active_until.
    subscription_plan         = Column(String, nullable=True)
    subscription_active_until = Column(DateTime, nullable=True)

    created_at       = Column(DateTime, default=datetime.utcnow)

    # Relationships
    interviews = relationship("Interview", back_populates="user", cascade="all, delete")
    transactions = relationship("Transaction", back_populates="user", cascade="all, delete")


# ============================================================
# TRANSACTION TABLE
# One row per successful (signature-verified) Razorpay payment.
# This is the permanent purchase history — separate from
# User.subscription_plan / subscription_active_until, which only
# track the CURRENT active plan and get overwritten on renewal.
# ============================================================
class Transaction(Base):
    __tablename__ = "transactions"

    id                   = Column(Integer, primary_key=True, index=True)
    user_id              = Column(Integer, ForeignKey("users.id"), nullable=False)

    plan                 = Column(String, nullable=False)   # "weekly" or "monthly"
    amount_paise         = Column(Integer, nullable=False)  # amount actually paid, in paise
    currency             = Column(String, default="INR", nullable=False)

    razorpay_order_id    = Column(String, nullable=False)
    razorpay_payment_id  = Column(String, nullable=False, unique=True, index=True)

    status               = Column(String, default="success", nullable=False)  # only successful payments are ever stored
    active_until          = Column(DateTime, nullable=False)  # subscription_active_until AFTER this payment was applied

    created_at           = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="transactions")


# ============================================================
# OTP VERIFICATION TABLE
# One active row per (email, purpose). Used for:
#   - "register"        -> verifying email right after signup
#   - "login"            -> OTP-based login (passwordless)
#   - "reset_password"   -> forgot password flow
# The OTP itself is never stored in plain text, only its hash.
# ============================================================
class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id           = Column(Integer, primary_key=True, index=True)
    email        = Column(String, index=True, nullable=False)
    purpose      = Column(String, nullable=False)   # register | login | reset_password
    otp_hash     = Column(String, nullable=False)
    attempts     = Column(Integer, default=0)        # failed verify attempts
    expires_at   = Column(DateTime, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


# ============================================================
# INTERVIEW TABLE
# ============================================================
class Interview(Base):
    __tablename__ = "interviews"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False)

    role            = Column(String, nullable=False)        # e.g. "Frontend Developer"
    difficulty      = Column(String, nullable=False)        # e.g. "medium"
    duration_limit  = Column(Integer, default=300)          # seconds

    status          = Column(String, default="in_progress") # in_progress / completed / cheating_terminated / failed
    overall_score   = Column(Float, nullable=True)

    started_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)

    # Set only when status == "failed" — human-readable reason the
    # interview never finished (tab closed, network drop, API error,
    # stale/abandoned session, etc). Shown in history so the candidate
    # understands what happened; these interviews are excluded from
    # the free-trial quota count since they were never the user's fault.
    failure_reason  = Column(Text, nullable=True)

    # New fields for government sector
    sector               = Column(String, nullable=True, default="private")  # "private" or "government"
    government_domain    = Column(String, nullable=True)  # e.g. "UPSC", "SSC", "Banking"
    government_role      = Column(String, nullable=True)  # e.g. "IAS", "CGL", "PO"
    biodata              = Column(Text, nullable=True)  # JSON string or raw text of biodata
    biodata_source       = Column(String, nullable=True)  # "upload" or "form"
    candidate_summary    = Column(Text, nullable=True)  # Candidate's self-intro summary (max 200 words)

    # Optional, private sector only — the company the candidate is prepping
    # for (e.g. "Google", "TCS"). Used only to silently shape Arjun's
    # question style server/prompt-side; never spoken aloud in the interview.
    target_company       = Column(String, nullable=True)

    # Optional, private sector only — 'technical' | 'hr' | 'mixed'.
    # Defaults to 'mixed' (the original, always-available behavior).
    interview_round       = Column(String, nullable=True, default='mixed')

    # How many times /api/chat has been called for this interview — caps
    # per-interview LLM usage so the proxy endpoint can't be hammered for
    # free/unlimited AI calls unrelated to the actual interview. Nullable
    # because rows created before this column existed won't have a value
    # (the auto-migration ADDs the column but doesn't backfill old rows);
    # the /chat route treats a NULL/missing value as 0.
    chat_call_count        = Column(Integer, nullable=True, default=0)

    # Relationships
    user      = relationship("User", back_populates="interviews")
    questions = relationship("InterviewQuestion", back_populates="interview", cascade="all, delete")
    feedback  = relationship("Feedback", back_populates="interview", uselist=False, cascade="all, delete")


# ============================================================
# INTERVIEW QUESTION/ANSWER TABLE
# ============================================================
class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id            = Column(Integer, primary_key=True, index=True)
    interview_id  = Column(Integer, ForeignKey("interviews.id"), nullable=False)

    question_text = Column(Text, nullable=False)
    answer_text   = Column(Text, nullable=True)

    order_index   = Column(Integer, default=0)
    created_at    = Column(DateTime, default=datetime.utcnow)

    # Relationships
    interview = relationship("Interview", back_populates="questions")


# ============================================================
# FEEDBACK / REPORT TABLE
# ============================================================
class Feedback(Base):
    __tablename__ = "feedback"

    id               = Column(Integer, primary_key=True, index=True)
    interview_id     = Column(Integer, ForeignKey("interviews.id"), unique=True, nullable=False)

    overall_score         = Column(Float, default=0)
    hiring_recommendation = Column(String, nullable=True)
    summary                = Column(Text, nullable=True)

    technical_score      = Column(Float, default=0)
    soft_skills_score    = Column(Float, default=0)

    eye_contact_score    = Column(Float, nullable=True)
    confidence_score     = Column(Float, nullable=True)
    engagement_score     = Column(Float, nullable=True)

    strengths            = Column(Text, nullable=True)   # JSON string
    areas_to_improve     = Column(Text, nullable=True)   # JSON string
    next_steps           = Column(Text, nullable=True)
    personal_note        = Column(Text, nullable=True)

    # Integrity report — captured client-side during the interview
    # (js/cheating.js) and persisted here so it survives past the results
    # screen: viewable later in history and by admin, not just once at
    # the moment the interview ends.
    integrity_score      = Column(Float, nullable=True)   # null = camera was unavailable, not "100 = clean"
    integrity_verdict    = Column(String, nullable=True)
    tab_switches         = Column(Integer, nullable=True)
    window_switches      = Column(Integer, nullable=True)
    camera_unavailable   = Column(Boolean, nullable=True, default=False)
    integrity_details    = Column(Text, nullable=True)   # JSON string: face_detection/response_timing/off_turn_audio

    created_at           = Column(DateTime, default=datetime.utcnow)

    # Relationships
    interview = relationship("Interview", back_populates="feedback")


# ============================================================
# SITE VISIT COUNTER
# A single row (id=1) holding a running total of website visits.
# Incremented via an atomic UPDATE from routes/visits.py so
# concurrent requests can't stomp on each other's count.
# ============================================================
class SiteVisit(Base):
    __tablename__ = "site_visits"

    id           = Column(Integer, primary_key=True, index=True)
    total_visits = Column(Integer, default=0, nullable=False)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============================================================
# QUESTION BANK TABLES — append to models/database.py
# Add these class definitions anywhere before the "CREATE ALL TABLES"
# section (i.e. before init_db()), so Base.metadata.create_all() picks
# them up automatically. No other change to database.py is needed —
# init_db()'s existing _sync_missing_columns() will also auto-add any
# columns if these models grow later, same as every other table here.
# ============================================================

# ============================================================
# QUESTION BANK TABLE
# One row per question, shared across all three categories
# (aptitude / coding / interview) since they share the same core
# fields (category, topic, difficulty, prompt). Category-specific
# fields are simply nullable when not applicable.
# ============================================================
class QuestionBank(Base):
    __tablename__ = "question_bank"

    id            = Column(Integer, primary_key=True, index=True)

    category      = Column(String, nullable=False, index=True)   # 'aptitude' | 'coding' | 'interview'
    topic         = Column(String, nullable=False, index=True)   # e.g. 'percentages', 'arrays', 'behavioral'
    difficulty    = Column(String, nullable=False, index=True)   # 'easy' | 'medium' | 'hard'

    prompt        = Column(Text, nullable=False)                 # the question text itself

    # --- Aptitude-only fields (MCQ) ---
    options       = Column(Text, nullable=True)   # JSON array of strings, e.g. ["12%", "15%", "18%", "20%"]
    correct_index = Column(Integer, nullable=True)  # index into options[] — which one is correct
    explanation   = Column(Text, nullable=True)    # shown after the user answers, any category

    # --- Coding-only fields ---
    starter_code  = Column(Text, nullable=True)    # boilerplate shown in the editor (Phase 4)
    constraints   = Column(Text, nullable=True)    # e.g. "1 <= n <= 10^5, time limit 1s"

    # --- Interview-only fields ---
    guidance_notes = Column(Text, nullable=True)   # what a strong answer should cover — used by
                                                    # feedback scoring in a later phase, not shown to candidate

    is_active     = Column(Boolean, default=True, nullable=False)  # soft-disable a bad question without deleting it
    created_at    = Column(DateTime, default=datetime.utcnow)

    # Relationships
    test_cases    = relationship("CodingTestCase", back_populates="question", cascade="all, delete")


# ============================================================
# CODING TEST CASE TABLE
# Only used by category == 'coding' questions. Kept as a separate
# table (not JSON on QuestionBank) because a question can have many
# cases and the coding-round grader (Phase 4) needs to run each one
# individually and report pass/fail per case.
# ============================================================
class CodingTestCase(Base):
    __tablename__ = "coding_test_cases"

    id              = Column(Integer, primary_key=True, index=True)
    question_id     = Column(Integer, ForeignKey("question_bank.id"), nullable=False)

    input           = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=False)

    # Sample cases are shown to the candidate alongside the problem
    # statement (so they know the expected format); non-sample cases
    # are hidden and only used for grading in Phase 4.
    is_sample       = Column(Boolean, default=False, nullable=False)

    order_index     = Column(Integer, default=0)

    # Relationships
    question = relationship("QuestionBank", back_populates="test_cases")


# ============================================================
# APTITUDE ATTEMPT TABLE
# One row per aptitude-test session a candidate takes from
# /aptitude (Phase 3). Stores which questions were served, what the
# candidate answered, and the graded outcome, so results can be
# re-shown later in My Reports (history.html) without re-grading.
# ============================================================
class AptitudeAttempt(Base):
    __tablename__ = "aptitude_attempts"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    topic           = Column(String, nullable=True)   # null = mixed across all topics
    difficulty      = Column(String, nullable=True)   # null = mixed across all difficulties

    question_ids    = Column(Text, nullable=False)    # JSON array of QuestionBank ids, in the order served
    answers         = Column(Text, nullable=True)      # JSON object: { "<question_id>": selected_index }

    total_questions = Column(Integer, nullable=False)
    correct_count   = Column(Integer, nullable=True)   # null until submitted
    score_percent   = Column(Float, nullable=True)     # null until submitted
    time_taken_seconds = Column(Integer, nullable=True)

    status          = Column(String, default="in_progress", nullable=False)  # in_progress | completed | abandoned

    started_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)

    # Relationships
    user = relationship("User")


# ============================================================
# CREATE ALL TABLES
# ============================================================
def init_db():
    """
    Create all tables in the database, then reconcile any columns that
    exist on the SQLAlchemy models but are missing from the actual
    tables (e.g. a column was added to a model after the table was
    already created in production — create_all() alone never ALTERs
    existing tables, so without this, a new nullable column silently
    breaks every query that touches it until someone manually migrates).

    This only ever ADDS missing nullable columns. It never drops or
    modifies existing columns, so it's safe to run on every startup.
    """
    Base.metadata.create_all(bind=engine)
    _sync_missing_columns()


def _sync_missing_columns():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    # Map SQLAlchemy column types to basic SQL types for ALTER TABLE.
    # Keep this minimal — it only needs to cover types actually used
    # in the models above (Integer, String, Text, Boolean, Float, DateTime).
    type_map = {
        "INTEGER": "INTEGER",
        "VARCHAR": "VARCHAR",
        "TEXT": "TEXT",
        "BOOLEAN": "BOOLEAN",
        "FLOAT": "FLOAT",
        "DATETIME": "TIMESTAMP",
    }

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all() just made it fresh; nothing to reconcile

        existing_columns = {col["name"] for col in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in existing_columns:
                continue

            sql_type = type_map.get(str(column.type).split("(")[0], None)
            if sql_type is None:
                logger_msg = (
                    f"[init_db] Skipping auto-migration of {table.name}.{column.name}: "
                    f"unsupported type {column.type}. Add it manually."
                )
                print(logger_msg)
                continue

            print(f"[init_db] Adding missing column {table.name}.{column.name} ({sql_type})")
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {column.name} {sql_type}"))


# ============================================================
# DEPENDENCY - Get DB session (used in routes)
# ============================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()