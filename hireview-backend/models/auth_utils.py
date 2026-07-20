# ============================================================
# Authentication Utilities
# File: models/auth_utils.py
# Password hashing + JWT token creation/verification
# ============================================================

import bcrypt
import re
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional

import config

# ============================================================
# PASSWORD STRENGTH VALIDATION
# Rule: at least 8 characters, and must contain at least one
# uppercase letter, one lowercase letter, one digit, and one
# special character.
# ============================================================
PASSWORD_MIN_LENGTH = 8
SPECIAL_CHARS_PATTERN = r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?`~]'

PASSWORD_REQUIREMENTS_MESSAGE = (
    f"Password must be at least {PASSWORD_MIN_LENGTH} characters long and include "
    "at least one uppercase letter, one lowercase letter, one number, "
    "and one special character."
)


def validate_password_strength(password: str) -> tuple[bool, str]:
    """
    Checks a plain-text password against the strength policy.
    Returns (is_valid, error_message). error_message is "" when valid.
    """
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        return False, PASSWORD_REQUIREMENTS_MESSAGE
    if not re.search(r'[A-Z]', password):
        return False, PASSWORD_REQUIREMENTS_MESSAGE
    if not re.search(r'[a-z]', password):
        return False, PASSWORD_REQUIREMENTS_MESSAGE
    if not re.search(r'\d', password):
        return False, PASSWORD_REQUIREMENTS_MESSAGE
    if not re.search(SPECIAL_CHARS_PATTERN, password):
        return False, PASSWORD_REQUIREMENTS_MESSAGE
    return True, ""


# ============================================================
# PASSWORD HASHING
# Using bcrypt directly (not passlib) - passlib is unmaintained and
# breaks with newer bcrypt releases ("(trapped) error reading bcrypt
# version"). bcrypt truncates at 72 bytes internally, so long
# passwords are capped rather than raising an error.
# ============================================================
def hash_password(password: str) -> str:
    """Hash a plain text password"""
    pw_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check if plain password matches the hash"""
    try:
        pw_bytes = plain_password.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ============================================================
# JWT TOKEN HANDLING
# ============================================================
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, config.SECRET_KEY, algorithm=config.ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT token. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        return payload
    except JWTError:
        return None