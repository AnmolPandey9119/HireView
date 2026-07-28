# ============================================================
# Payment Routes
# File: routes/payments.py
# Razorpay integration: create an order for a plan, then verify
# the payment signature Razorpay sends back after checkout.
#
# Flow:
#   1. Frontend calls POST /api/payments/create-order with a plan
#      ("weekly" or "monthly"). We create a Razorpay Order and
#      return its id + amount + the public Key ID.
#   2. Frontend opens Razorpay Checkout with that order id.
#   3. On success, Razorpay gives the frontend a payment id +
#      signature. Frontend sends those to POST /api/payments/verify.
#   4. We verify the signature server-side (never trust the
#      frontend alone) and only THEN activate the subscription.
#
# This is a one-time payment per plan (no auto-renewal), matching
# the existing subscription_plan / subscription_active_until fields
# on the User model — see models/database.py.
# ============================================================

import hashlib
import hmac
import logging
import os
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.database import get_db, User, Transaction
from routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

RAZORPAY_API_BASE = "https://api.razorpay.com/v1"

# plan -> (amount in paise, validity in days). Keep in sync with the
# prices shown on the pricing page (Weekly ₹99 / Monthly ₹299).
PLANS = {
    "weekly":  {"amount_paise": 9900,  "days": 7,  "label": "Weekly Plan"},
    "monthly": {"amount_paise": 29900, "days": 30, "label": "Monthly Plan"},
}


def _razorpay_auth():
    key_id = os.environ.get("RAZORPAY_KEY_ID")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise HTTPException(status_code=500, detail="Razorpay keys not configured")
    return key_id, key_secret


# ============================================================
# POST /api/payments/create-order
# ============================================================
@router.post("/payments/create-order")
async def create_order(
    request: dict,
    current_user: User = Depends(get_current_user)
):
    plan = request.get("plan")
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan. Use 'weekly' or 'monthly'.")

    key_id, key_secret = _razorpay_auth()
    plan_info = PLANS[plan]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{RAZORPAY_API_BASE}/orders",
            auth=(key_id, key_secret),
            json={
                "amount": plan_info["amount_paise"],
                "currency": "INR",
                # Razorpay requires receipts to be unique and <=40 chars.
                "receipt": f"hv_{current_user.id}_{int(datetime.utcnow().timestamp())}",
                "notes": {
                    "user_id": str(current_user.id),
                    "email": current_user.email,
                    "plan": plan
                }
            },
            timeout=15.0
        )

    if response.status_code != 200:
        logger.error(f"Razorpay order creation failed: {response.status_code} {response.text[:300]}")
        raise HTTPException(status_code=502, detail="Could not create payment order")

    order = response.json()

    return {
        "order_id": order["id"],
        "amount": order["amount"],       # paise — Razorpay Checkout wants this exact value
        "currency": order["currency"],
        "key_id": key_id,                # public, safe to send to frontend
        "plan": plan,
        "plan_label": plan_info["label"]
    }


# ============================================================
# POST /api/payments/verify
# ============================================================
@router.post("/payments/verify")
async def verify_payment(
    request: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    order_id   = request.get("razorpay_order_id")
    payment_id = request.get("razorpay_payment_id")
    signature  = request.get("razorpay_signature")
    plan       = request.get("plan")

    if not (order_id and payment_id and signature and plan in PLANS):
        raise HTTPException(status_code=400, detail="Missing or invalid payment verification fields")

    _, key_secret = _razorpay_auth()

    # This is the step that actually matters: recompute the signature
    # ourselves from the secret key. If it doesn't match, someone is
    # trying to fake a successful payment — never trust order_id/
    # payment_id from the frontend alone.
    payload = f"{order_id}|{payment_id}"
    expected_signature = hmac.new(
        key_secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature):
        logger.warning(f"Razorpay signature mismatch for user {current_user.id}, order {order_id}")
        raise HTTPException(status_code=400, detail="Payment verification failed")

    # Signature is genuine — activate the subscription.
    plan_info = PLANS[plan]
    now = datetime.utcnow()
    # If they already have active time left on the same tier, extend from
    # that instead of overwriting it (so an early renewal isn't wasted).
    base_time = current_user.subscription_active_until
    if not base_time or base_time < now:
        base_time = now

    current_user.subscription_plan = plan
    current_user.subscription_active_until = base_time + timedelta(days=plan_info["days"])

    # Record this as a permanent transaction — this is what powers the
    # Payment & Subscription history list on the frontend. Unlike
    # subscription_plan/active_until (which get overwritten on renewal),
    # this row is never touched again.
    db.add(Transaction(
        user_id=current_user.id,
        plan=plan,
        amount_paise=plan_info["amount_paise"],
        currency="INR",
        razorpay_order_id=order_id,
        razorpay_payment_id=payment_id,
        status="success",
        active_until=current_user.subscription_active_until
    ))

    db.commit()

    logger.info(f"Payment verified: user {current_user.id}, plan {plan}, payment {payment_id}")

    return {
        "status": "success",
        "plan": plan,
        "subscription_active_until": current_user.subscription_active_until.isoformat()
    }


# ============================================================
# GET /api/payments/history
# Returns the current user's past successful payments, most
# recent first. Powers the "Payment & Subscription" history
# list on the dashboard.
# ============================================================
@router.get("/payments/history")
async def payment_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .all()
    )

    return {
        "transactions": [
            {
                "id": t.id,
                "plan": t.plan,
                "plan_label": PLANS.get(t.plan, {}).get("label", t.plan.title()),
                "amount_paise": t.amount_paise,
                "currency": t.currency,
                "razorpay_payment_id": t.razorpay_payment_id,
                "status": t.status,
                "active_until": t.active_until.isoformat(),
                "created_at": t.created_at.isoformat()
            }
            for t in transactions
        ]
    }