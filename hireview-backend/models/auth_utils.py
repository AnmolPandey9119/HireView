# ============================================================
# Authentication Utilities
# File: models/auth_utils.py
# Password hashing + JWT token creation/verification
# ============================================================

import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional

import config

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