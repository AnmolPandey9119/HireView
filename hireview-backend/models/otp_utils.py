# ============================================================
# OTP Utilities
# File: models/otp_utils.py
#
# Handles generating, storing (hashed), and verifying OTPs.
#
# PRODUCTION NOTE: right now `generate_otp()` just picks 6 random
# digits. When you're ready to swap to a dedicated Python OTP
# library (e.g. `pyotp` for time-based TOTP codes), you only need
# to change `generate_otp()` below — everything else (hashing,
# storage, expiry, rate limiting, verification) stays the same.
# ============================================================

import secrets
import bcrypt
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

import config
from models.database import OTPVerification


def generate_otp() -> str:
    """Generate a numeric OTP of config.OTP_LENGTH digits."""
    return "".join(secrets.choice("0123456789") for _ in range(config.OTP_LENGTH))


def _hash_otp(otp: str) -> str:
    return bcrypt.hashpw(otp.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_otp_hash(otp: str, otp_hash: str) -> bool:
    try:
        return bcrypt.checkpw(otp.encode("utf-8"), otp_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def get_active_otp(db: Session, email: str, purpose: str) -> OTPVerification | None:
    return (
        db.query(OTPVerification)
        .filter(OTPVerification.email == email, OTPVerification.purpose == purpose)
        .first()
    )


def can_resend(db: Session, email: str, purpose: str) -> tuple[bool, int]:
    """
    Returns (allowed, seconds_to_wait). Prevents spamming OTP requests
    (and racking up your Brevo email quota) for the same email/purpose.
    """
    existing = get_active_otp(db, email, purpose)
    if not existing:
        return True, 0

    elapsed = (datetime.utcnow() - existing.created_at).total_seconds()
    remaining = config.OTP_RESEND_COOLDOWN_SECONDS - elapsed
    if remaining > 0:
        return False, int(remaining) + 1
    return True, 0


def create_otp(db: Session, email: str, purpose: str) -> str:
    """
    Generates a fresh OTP, replaces any existing one for this
    email/purpose, and returns the plain OTP (caller emails it).
    """
    otp = generate_otp()

    existing = get_active_otp(db, email, purpose)
    if existing:
        db.delete(existing)
        db.flush()

    record = OTPVerification(
        email=email,
        purpose=purpose,
        otp_hash=_hash_otp(otp),
        attempts=0,
        expires_at=datetime.utcnow() + timedelta(minutes=config.OTP_EXPIRY_MINUTES),
    )
    db.add(record)
    db.commit()

    return otp


def verify_otp(db: Session, email: str, purpose: str, submitted_otp: str) -> tuple[bool, str]:
    """
    Verifies an OTP. Returns (success, error_message).
    On success, the OTP record is deleted (single use).
    On failure, increments the attempt counter and invalidates
    the OTP entirely once OTP_MAX_VERIFY_ATTEMPTS is hit.
    """
    record = get_active_otp(db, email, purpose)

    if not record:
        return False, "No OTP request found. Please request a new code."

    if datetime.utcnow() > record.expires_at:
        db.delete(record)
        db.commit()
        return False, "This code has expired. Please request a new one."

    if record.attempts >= config.OTP_MAX_VERIFY_ATTEMPTS:
        db.delete(record)
        db.commit()
        return False, "Too many incorrect attempts. Please request a new code."

    if not _verify_otp_hash(submitted_otp, record.otp_hash):
        record.attempts += 1
        db.commit()
        remaining = config.OTP_MAX_VERIFY_ATTEMPTS - record.attempts
        return False, f"Incorrect code. {remaining} attempt(s) remaining."

    # Success — single use, delete it
    db.delete(record)
    db.commit()
    return True, ""


# ============================================================
# EMAIL-VERIFIED MARKER (used between "verify OTP" and "create account")
#
# Signup flow: user verifies their email via OTP BEFORE the account
# exists. On successful OTP verification we drop a short-lived marker
# (reusing the same table, purpose="email_verified") so /auth/register
# can confirm the email was actually verified moments earlier.
# ============================================================
EMAIL_VERIFIED_TTL_MINUTES = 30


def mark_email_verified(db: Session, email: str) -> None:
    existing = get_active_otp(db, email, "email_verified")
    if existing:
        db.delete(existing)
        db.flush()

    record = OTPVerification(
        email=email,
        purpose="email_verified",
        otp_hash=_hash_otp("verified"),  # value is irrelevant, presence+expiry is what matters
        attempts=0,
        expires_at=datetime.utcnow() + timedelta(minutes=EMAIL_VERIFIED_TTL_MINUTES),
    )
    db.add(record)
    db.commit()


def consume_email_verified(db: Session, email: str) -> bool:
    """Returns True and deletes the marker if the email was verified recently."""
    record = get_active_otp(db, email, "email_verified")
    if not record:
        return False
    if datetime.utcnow() > record.expires_at:
        db.delete(record)
        db.commit()
        return False
    db.delete(record)
    db.commit()
    return True
