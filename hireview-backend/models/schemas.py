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

    class Config:
        from_attributes = True


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