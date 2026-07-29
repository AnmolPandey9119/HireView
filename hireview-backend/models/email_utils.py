# ============================================================
# Email Utilities
# File: models/email_utils.py
#
# Two independent anti-abuse checks used throughout auth.py:
#
#   canonicalize_email() — collapses Gmail's dot/+tag tricks
#   (anmol.pandey@gmail.com, anmol+trial1@gmail.com, anmolpandey@gmail.com
#   all deliver to the same inbox) down to one canonical form, so the
#   same person can't register multiple "different" accounts using the
#   same real inbox.
#
#   is_disposable_email() — rejects known temp-mail domains
#   (mailinator, 10minutemail, etc.) at signup, since there's no
#   legitimate reason for a real account to use one.
#
# Neither of these stops someone determined to make several genuinely
# different email addresses across several providers — that's a much
# harder problem (see phone verification / device fingerprinting for
# that). This just closes the free, one-line tricks.
# ============================================================

# Providers where the platform itself ignores dots and/or "+tag" in
# the local part. Extend this list if you notice abuse from another
# provider that behaves the same way (most don't — Outlook, Yahoo,
# and custom domains all treat dots/+ as significant).
_DOT_AND_PLUS_IGNORING_DOMAINS = {"gmail.com", "googlemail.com"}


def canonicalize_email(email: str) -> str:
    """Returns the canonical form of an email address for storage,
    lookup, and OTP-keying. Safe to call on any address — it only
    changes Gmail-family addresses; everything else is just lowercased."""
    email = (email or "").strip().lower()
    if "@" not in email:
        return email

    local, domain = email.rsplit("@", 1)

    if domain in _DOT_AND_PLUS_IGNORING_DOMAINS:
        local = local.split("+", 1)[0]   # anmol+trial1 -> anmol
        local = local.replace(".", "")   # anmol.pandey -> anmolpandey
        domain = "gmail.com"             # googlemail.com and gmail.com are the same inbox

    return f"{local}@{domain}"


# Common free/temporary/disposable email providers. Not exhaustive —
# new ones appear constantly — but covers the large majority of
# throwaway-signup traffic seen in practice. Add to this list as
# needed; no code changes required elsewhere.
DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.biz",
    "guerrillamail.de", "sharklasers.com", "grr.la", "guerrillamailblock.com",
    "10minutemail.com", "10minutemail.net", "10minutemail.co.za",
    "temp-mail.org", "tempmail.com", "tempmail.net", "tempmailo.com",
    "throwawaymail.com", "throwaway.email", "getnada.com", "nada.email",
    "maildrop.cc", "mailnesia.com", "mintemail.com", "fakeinbox.com",
    "yopmail.com", "yopmail.fr", "yopmail.net", "dispostable.com",
    "trashmail.com", "trashmail.net", "trash-mail.com", "discard.email",
    "discardmail.com", "spamgourmet.com", "mailcatch.com", "mytemp.email",
    "emailondeck.com", "moakt.com", "moakt.cc", "tempinbox.com",
    "burnermail.io", "einrot.com", "fakemailgenerator.com", "mohmal.com",
    "spam4.me", "tempr.email", "inboxbear.com", "mailsac.com",
    "tempmailaddress.com", "tempail.com", "luxusmail.org", "harakirimail.com",
}


def is_disposable_email(email: str) -> bool:
    """True if the email's domain is a known temp-mail/disposable provider."""
    email = (email or "").strip().lower()
    if "@" not in email:
        return False
    domain = email.rsplit("@", 1)[1]
    return domain in DISPOSABLE_EMAIL_DOMAINS