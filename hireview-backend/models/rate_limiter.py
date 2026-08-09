# ============================================================
# Rate Limiter
# File: models/rate_limiter.py
#
# A minimal in-memory sliding-window limiter for brute-force protection
# on sensitive endpoints (login, admin login). No new dependency, no
# Redis — fine for a single web-service instance (which is what this
# app runs on Render). If this service is ever scaled to multiple
# instances behind a load balancer, this in-memory store stops being
# shared across them and a Redis-backed limiter would be needed instead.
#
# Usage pattern (see routes/auth.py and routes/admin.py):
#   1. is_limited(key, max_attempts, window_seconds) BEFORE checking
#      credentials — blocks the request early, without even touching
#      bcrypt, if the caller is already over the limit.
#   2. On a FAILED login, record_failure(key) — only failures count
#      against the limit, so a normal user who mistypes their password
#      once or twice and then gets it right is never penalized.
#   3. On a SUCCESSFUL login, clear(key) — wipes the slate for that key.
# ============================================================

import time
import threading
from collections import defaultdict

_lock = threading.Lock()
_attempts: dict[str, list[float]] = defaultdict(list)

# Safety valve so this dict can never grow unbounded if the service runs
# for a long time under sustained attack traffic — prunes stale keys.
_MAX_TRACKED_KEYS = 50_000


def _prune(key: str, window_seconds: int) -> list[float]:
    now = time.time()
    cutoff = now - window_seconds
    kept = [t for t in _attempts[key] if t > cutoff]
    if kept:
        _attempts[key] = kept
    else:
        _attempts.pop(key, None)
    return kept


def is_limited(key: str, max_attempts: int, window_seconds: int) -> tuple[bool, int]:
    """Returns (limited, retry_after_seconds). Does not record anything."""
    with _lock:
        recent = _prune(key, window_seconds)
        if len(recent) >= max_attempts:
            retry_after = int(window_seconds - (time.time() - recent[0]))
            return True, max(retry_after, 1)
        return False, 0


def record_failure(key: str, window_seconds: int) -> None:
    with _lock:
        if len(_attempts) > _MAX_TRACKED_KEYS:
            _attempts.clear()  # crude but safe — worst case a few users get an early reset
        _attempts[key].append(time.time())
        _prune(key, window_seconds)


def clear(key: str) -> None:
    with _lock:
        _attempts.pop(key, None)


def get_client_ip(request) -> str:
    """
    Render sits behind a proxy/load balancer, so the real client IP is in
    X-Forwarded-For (first entry = original client), not request.client.host
    (which would be the proxy's internal IP).
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
