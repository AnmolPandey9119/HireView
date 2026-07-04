# ============================================================
# Authentication Routes
# File: routes/auth.py
# Register, Login, and "who am I" endpoints
# ============================================================

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from datetime import timedelta
import logging

import config
from models.database import get_db, User
from models.schemas import UserRegister, UserLogin, Token, UserResponse
from models.auth_utils import hash_password, verify_password, create_access_token, decode_access_token

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
    """
    Reads the Bearer token, verifies the JWT, and returns the matching User.
    Raises 401 if missing/invalid.
    """
    token = credentials.credentials
    payload = decode_access_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("user_id")
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


# ============================================================
# REGISTER
# ============================================================
@router.post("/auth/register", response_model=Token)
async def register(payload: UserRegister, db: Session = Depends(get_db)):
    """Create a new user account"""

    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        data={"user_id": user.id, "email": user.email},
        expires_delta=timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    logger.info(f"New user registered: {user.email}")

    return Token(access_token=token, user=UserResponse.model_validate(user))


# ============================================================
# LOGIN
# ============================================================
@router.post("/auth/login", response_model=Token)
async def login(payload: UserLogin, db: Session = Depends(get_db)):
    """Log in an existing user"""

    user = db.query(User).filter(User.email == payload.email).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_access_token(
        data={"user_id": user.id, "email": user.email},
        expires_delta=timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    logger.info(f"User logged in: {user.email}")

    return Token(access_token=token, user=UserResponse.model_validate(user))


# ============================================================
# GET CURRENT USER (verify token works)
# ============================================================
@router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently logged-in user's info"""
    return UserResponse.model_validate(current_user)