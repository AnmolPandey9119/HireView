# ============================================================
# Pydantic Schemas
# File: models/schemas.py
# Defines request/response shapes for the API
# ============================================================

from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


# ============================================================
# AUTH SCHEMAS
# ============================================================
class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    is_verified: bool
    profile_picture: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class MessageResponse(BaseModel):
    message: str


# ============================================================
# PROFILE SCHEMAS (Personal Info section)
# ============================================================
class UpdateProfileRequest(BaseModel):
    """Both fields optional — only what's sent gets changed.
    Email is NOT editable here; changing email goes through the
    separate OTP-verified change-email flow below."""
    name: Optional[str] = None
    profile_picture: Optional[str] = None  # base64 data URL

class ChangeEmailRequest(BaseModel):
    """Step 1: request an OTP be sent to the NEW email address."""
    new_email: EmailStr

class ChangeEmailVerify(BaseModel):
    """Step 2: verify the OTP sent to the new email, then swap it in."""
    new_email: EmailStr
    otp: str


# ============================================================
# OTP SCHEMAS
# ============================================================
class SendEmailOTPRequest(BaseModel):
    """Step 1 of signup: send an OTP to an email before the account exists."""
    email: EmailStr

class VerifyEmailOTPRequest(BaseModel):
    """Step 2 of signup: verify that OTP. On success, the email is marked
    verified for a short window so /auth/register can be called next."""
    email: EmailStr
    otp: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ForgotPasswordReset(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


# ============================================================
# VOICE SCHEMAS
# ============================================================
class SpeakRequest(BaseModel):
    text: str
    speed: float = 1.0


# ============================================================
# INTERVIEW SCHEMAS
# ============================================================
class InterviewCreate(BaseModel):
    role: str
    difficulty: str
    duration_limit: int = 300
    sector: Optional[str] = "private"  # "private" or "government"
    government_domain: Optional[str] = None
    government_role: Optional[str] = None
    biodata: Optional[str] = None
    biodata_source: Optional[str] = None
    candidate_summary: Optional[str] = None

class QuestionAnswer(BaseModel):
    question_text: str
    answer_text: str
    order_index: int = 0

class InterviewResponse(BaseModel):
    id: int
    role: str
    difficulty: str
    status: str
    overall_score: Optional[float]
    started_at: datetime
    completed_at: Optional[datetime]
    sector: Optional[str]
    government_domain: Optional[str]
    government_role: Optional[str]
    biodata: Optional[str]
    biodata_source: Optional[str]
    candidate_summary: Optional[str]

    class Config:
        from_attributes = True


# ============================================================
# ADMIN SCHEMAS
# ============================================================
class AdminLogin(BaseModel):
    username: str
    password: str

class AdminToken(BaseModel):
    access_token: str
    token_type: str = "bearer"

class AdminUserUpdate(BaseModel):
    """All fields optional — only what's sent gets changed."""
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    is_verified: Optional[bool] = None
    new_password: Optional[str] = None

class AdminInterviewUpdate(BaseModel):
    role: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[str] = None
    overall_score: Optional[float] = None
    sector: Optional[str] = None
    government_domain: Optional[str] = None
    government_role: Optional[str] = None
    candidate_summary: Optional[str] = None

class AdminQuestionUpdate(BaseModel):
    question_text: Optional[str] = None
    answer_text: Optional[str] = None
    order_index: Optional[int] = None

class AdminFeedbackUpdate(BaseModel):
    overall_score: Optional[float] = None
    hiring_recommendation: Optional[str] = None
    summary: Optional[str] = None
    technical_score: Optional[float] = None
    soft_skills_score: Optional[float] = None
    eye_contact_score: Optional[float] = None
    confidence_score: Optional[float] = None
    engagement_score: Optional[float] = None
    strengths: Optional[str] = None
    areas_to_improve: Optional[str] = None
    next_steps: Optional[str] = None


# ============================================================
# FEEDBACK SCHEMAS
# ============================================================
class FeedbackCreate(BaseModel):
    overall_score: float
    hiring_recommendation: Optional[str] = None
    summary: Optional[str] = None
    technical_score: float = 0
    soft_skills_score: float = 0
    eye_contact_score: Optional[float] = None
    confidence_score: Optional[float] = None
    engagement_score: Optional[float] = None
    strengths: Optional[List[str]] = []
    areas_to_improve: Optional[List[str]] = []
    next_steps: Optional[str] = None