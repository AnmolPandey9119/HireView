# ============================================================
# Database Models
# File: models/database.py
# Defines all tables: Users, Interviews, Resumes, Feedback
# ============================================================

from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

import config

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
    created_at       = Column(DateTime, default=datetime.utcnow)

    # Relationships
    interviews = relationship("Interview", back_populates="user", cascade="all, delete")


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

    status          = Column(String, default="in_progress") # in_progress / completed
    overall_score   = Column(Float, nullable=True)

    started_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)

    # New fields for government sector
    sector               = Column(String, nullable=True, default="private")  # "private" or "government"
    government_domain    = Column(String, nullable=True)  # e.g. "UPSC", "SSC", "Banking"
    government_role      = Column(String, nullable=True)  # e.g. "IAS", "CGL", "PO"
    biodata              = Column(Text, nullable=True)  # JSON string or raw text of biodata
    biodata_source       = Column(String, nullable=True)  # "upload" or "form"
    candidate_summary    = Column(Text, nullable=True)  # Candidate's self-intro summary (max 200 words)

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

    created_at           = Column(DateTime, default=datetime.utcnow)

    # Relationships
    interview = relationship("Interview", back_populates="feedback")


# ============================================================
# CREATE ALL TABLES
# ============================================================
def init_db():
    """Create all tables in the database"""
    Base.metadata.create_all(bind=engine)


# ============================================================
# DEPENDENCY - Get DB session (used in routes)
# ============================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()