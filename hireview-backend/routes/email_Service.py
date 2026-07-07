# ============================================================
# Email Service (Brevo transactional email)
# File: services/email_service.py
#
# Sends OTP emails via Brevo's HTTP API. Kept in its own module
# so it's a drop-in swap later — e.g. if you move to sending OTPs
# via SMS, or generate them with a dedicated library like `pyotp`
# instead of the random-digit generator in models/otp_utils.py,
# nothing outside this file and otp_utils.py needs to change.
# ============================================================

import logging
import httpx

import config

logger = logging.getLogger(__name__)

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"

# Subject/body copy per purpose, so one function handles all 3 OTP flows
_PURPOSE_COPY = {
    "register": {
        "subject": "Verify your HireView account",
        "heading": "Confirm your email",
        "body": "Use the code below to verify your email and finish creating your HireView account.",
    },
    "login": {
        "subject": "Your HireView login code",
        "heading": "Log in to HireView",
        "body": "Use the code below to log in to your HireView account.",
    },
    "reset_password": {
        "subject": "Reset your HireView password",
        "heading": "Reset your password",
        "body": "Use the code below to reset your HireView password. If you didn't request this, you can ignore this email.",
    },
}


def _build_html(name: str, otp: str, purpose: str) -> str:
    copy = _PURPOSE_COPY.get(purpose, _PURPOSE_COPY["login"])
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color:#111;">{copy['heading']}</h2>
      <p>Hi {name or 'there'},</p>
      <p>{copy['body']}</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; background:#f4f4f7; padding: 16px 24px; border-radius: 8px; text-align:center; margin: 20px 0;">
        {otp}
      </div>
      <p style="color:#666; font-size: 14px;">This code expires in {config.OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.</p>
      <p style="color:#999; font-size: 12px; margin-top: 32px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    """


async def send_otp_email(to_email: str, otp: str, purpose: str, name: str = "") -> bool:
    """
    Send an OTP email via Brevo. Returns True on success, False on failure
    (caller decides whether a failure should block the request or just be logged).
    """
    if not config.BREVO_API_KEY:
        # Fail loudly in logs but don't crash the request — lets you develop
        # locally without a Brevo key by reading the OTP from the server logs.
        logger.warning(f"BREVO_API_KEY not set. OTP for {to_email} ({purpose}): {otp}")
        return False

    copy = _PURPOSE_COPY.get(purpose, _PURPOSE_COPY["login"])

    payload = {
        "sender": {"name": config.BREVO_SENDER_NAME, "email": config.BREVO_SENDER_EMAIL},
        "to": [{"email": to_email, "name": name or to_email}],
        "subject": copy["subject"],
        "htmlContent": _build_html(name, otp, purpose),
    }

    headers = {
        "accept": "application/json",
        "api-key": config.BREVO_API_KEY,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(BREVO_ENDPOINT, json=payload, headers=headers)

        if response.status_code in (200, 201):
            logger.info(f"OTP email sent to {to_email} (purpose={purpose})")
            return True

        logger.error(f"Brevo send failed ({response.status_code}) for {to_email}: {response.text}")
        return False

    except httpx.HTTPError as e:
        logger.error(f"Brevo request error for {to_email}: {e}")
        return False
