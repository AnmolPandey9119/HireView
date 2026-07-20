# ============================================================
# Authentication Routes
# File: routes/auth.py
#
# Flow:
#   1. POST /auth/send-email-otp      -> email an OTP (no account yet)
#   2. POST /auth/verify-email-otp    -> verify it; marks email as
#                                         verified for 30 min
#   3. POST /auth/register            -> creates the account, only
#                                         allowed if step 2 just succeeded
#   4. POST /auth/login               -> normal password login
#   5. Forgot password (OTP-based): /forgot-password/request + /reset
# ============================================================

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from datetime import timedelta
import base64
import logging

import config
from models.database import get_db, User
from models.schemas import (
    UserRegister, UserLogin, Token, UserResponse, MessageResponse,
    SendEmailOTPRequest, VerifyEmailOTPRequest,
    ForgotPasswordRequest, ForgotPasswordReset,
    UpdateProfileRequest, ChangeEmailRequest, ChangeEmailVerify,
)
from models.auth_utils import (
    hash_password, verify_password, create_access_token, decode_access_token,
    validate_password_strength,
)
from models.otp_utils import create_otp, verify_otp, can_resend, mark_email_verified, consume_email_verified
from routes.email_Service import send_otp_email

logger = logging.getLogger(__name__)
router = APIRouter()
security = HTTPBearer()


# ============================================================
# DEPENDENCY: Get current logged-in user from JWT token
# ============================================================
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = decode_access_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("user_id")
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def _issue_token(user: User) -> Token:
    token = create_access_token(
        data={"user_id": user.id, "email": user.email},
        expires_delta=timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return Token(access_token=token, user=UserResponse.model_validate(user))


# ============================================================
# STEP 1: SEND EMAIL OTP  (before account exists)
# ============================================================
@router.post("/auth/send-email-otp", response_model=MessageResponse)
async def send_email_otp(payload: SendEmailOTPRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing and existing.is_verified:
        raise HTTPException(status_code=400, detail="This email is already registered. Please log in instead.")

    allowed, wait_seconds = can_resend(db, payload.email, "register")
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds}s before requesting another code.")

    otp = create_otp(db, payload.email, "register")
    sent = await send_otp_email(payload.email, otp, "register")

    if not sent and config.BREVO_API_KEY:
        raise HTTPException(status_code=502, detail="Could not send OTP email. Please try again.")

    return MessageResponse(message="A verification code has been sent to your email.")


# ============================================================
# STEP 2: VERIFY EMAIL OTP  (marks email verified for 30 min)
# ============================================================
@router.post("/auth/verify-email-otp", response_model=MessageResponse)
async def verify_email_otp(payload: VerifyEmailOTPRequest, db: Session = Depends(get_db)):
    success, error = verify_otp(db, payload.email, "register", payload.otp)
    if not success:
        raise HTTPException(status_code=400, detail=error)

    mark_email_verified(db, payload.email)
    logger.info(f"Email verified (pre-signup): {payload.email}")

    return MessageResponse(message="Email verified successfully.")


# ============================================================
# STEP 3: REGISTER  (only works right after step 2 succeeded)
# ============================================================
@router.post("/auth/register", response_model=Token)
async def register(payload: UserRegister, db: Session = Depends(get_db)):
    if not consume_email_verified(db, payload.email):
        raise HTTPException(
            status_code=400,
            detail="Please verify your email with the OTP before creating your account."
        )

    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        if existing.is_verified:
            raise HTTPException(status_code=400, detail="Email already registered")
        # An old unverified row from a previous flow — reuse it
        is_valid, error = validate_password_strength(payload.password)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error)

        existing.name = payload.name
        existing.password_hash = hash_password(payload.password)
        existing.is_verified = True
        db.commit()
        db.refresh(existing)
        logger.info(f"New user registered: {existing.email}")
        return _issue_token(existing)

    is_valid, error = validate_password_strength(payload.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_verified=True,  # email was already verified in step 2
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"New user registered: {user.email}")
    return _issue_token(user)


# ============================================================
# LOGIN (password)
# ============================================================
@router.post("/auth/login", response_model=Token)
async def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if not user.is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before logging in")

    logger.info(f"User logged in: {user.email}")
    return _issue_token(user)


# ============================================================
# FORGOT PASSWORD — step 1: request a code
# ============================================================
@router.post("/auth/forgot-password/request", response_model=MessageResponse)
async def forgot_password_request(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if user and user.is_verified:
        allowed, wait_seconds = can_resend(db, payload.email, "reset_password")
        if not allowed:
            raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds}s before requesting another code.")

        otp = create_otp(db, payload.email, "reset_password")
        await send_otp_email(payload.email, otp, "reset_password", name=user.name)

    # Same message whether or not the account exists — avoids leaking which emails are registered
    return MessageResponse(message="If that email is registered, a reset code has been sent.")


# ============================================================
# FORGOT PASSWORD — step 2: verify code + set new password
# ============================================================
@router.post("/auth/forgot-password/reset", response_model=MessageResponse)
async def forgot_password_reset(payload: ForgotPasswordReset, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect or expired code")

    is_valid, error = validate_password_strength(payload.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    success, error = verify_otp(db, payload.email, "reset_password", payload.otp)
    if not success:
        raise HTTPException(status_code=400, detail=error)

    user.password_hash = hash_password(payload.new_password)
    db.commit()

    logger.info(f"Password reset: {user.email}")
    return MessageResponse(message="Password updated successfully. Please log in.")


# ============================================================
# GET CURRENT USER
# ============================================================
@router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ============================================================
# UPDATE PROFILE — name and/or profile picture
# (Email is intentionally NOT handled here — see change-email
# flow below, which requires OTP verification.)
# ============================================================
@router.put("/auth/profile", response_model=UserResponse)
async def update_profile(
    payload: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        if len(name) > 100:
            raise HTTPException(status_code=400, detail="Name is too long")
        current_user.name = name

    if payload.profile_picture is not None:
        pic = payload.profile_picture.strip()
        if pic == "":
            # Empty string = explicit removal
            current_user.profile_picture = None
        else:
            if not pic.startswith("data:image/"):
                raise HTTPException(status_code=400, detail="Profile picture must be an image data URL")

            try:
                _, b64_data = pic.split(",", 1)
                decoded_size = len(base64.b64decode(b64_data, validate=True))
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid image data")

            if decoded_size > config.MAX_PROFILE_PICTURE_BYTES:
                max_kb = config.MAX_PROFILE_PICTURE_BYTES // 1024
                raise HTTPException(status_code=400, detail=f"Image is too large. Please use an image under {max_kb}KB.")

            current_user.profile_picture = pic

    db.commit()
    db.refresh(current_user)
    logger.info(f"Profile updated: {current_user.email}")
    return UserResponse.model_validate(current_user)


# ============================================================
# CHANGE EMAIL — step 1: send an OTP to the NEW email
# ============================================================
@router.post("/auth/change-email/request", response_model=MessageResponse)
async def change_email_request(
    payload: ChangeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_email = payload.new_email.lower()

    if new_email == current_user.email.lower():
        raise HTTPException(status_code=400, detail="That's already your current email")

    existing = db.query(User).filter(User.email == new_email).first()
    if existing:
        raise HTTPException(status_code=400, detail="This email is already in use by another account")

    allowed, wait_seconds = can_resend(db, new_email, "change_email")
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds}s before requesting another code.")

    otp = create_otp(db, new_email, "change_email")
    sent = await send_otp_email(new_email, otp, "change_email", name=current_user.name)

    if not sent and config.BREVO_API_KEY:
        raise HTTPException(status_code=502, detail="Could not send verification email. Please try again.")

    return MessageResponse(message=f"A verification code has been sent to {new_email}.")


# ============================================================
# CHANGE EMAIL — step 2: verify the OTP, then swap the email
# ============================================================
@router.post("/auth/change-email/verify", response_model=Token)
async def change_email_verify(
    payload: ChangeEmailVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_email = payload.new_email.lower()

    success, error = verify_otp(db, new_email, "change_email", payload.otp)
    if not success:
        raise HTTPException(status_code=400, detail=error)

    # Re-check in case someone else claimed this email while the OTP was pending
    existing = db.query(User).filter(User.email == new_email).first()
    if existing and existing.id != current_user.id:
        raise HTTPException(status_code=400, detail="This email is already in use by another account")

    current_user.email = new_email
    db.commit()
    db.refresh(current_user)

    logger.info(f"Email changed for user {current_user.id}: now {current_user.email}")

    # Issue a fresh token — the old one's "email" claim is now stale
    return _issue_token(current_user)