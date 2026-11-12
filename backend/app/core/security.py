import hashlib
import secrets
from collections import defaultdict, deque
from datetime import timedelta
from threading import Lock
from time import monotonic

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response

from app.db.mongo import get_db
from app.schemas.entities import utcnow

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(encoded: str, password: str) -> bool:
    try:
        return hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


class RateLimiter:
    """Bounded, thread-safe sliding window for one process. Never trusts forwarded IP headers."""
    def __init__(self):
        self.entries = defaultdict(deque)
        self.lock = Lock()

    def check(self, key, limit, window):
        now = monotonic()
        with self.lock:
            # Remove idle keys to keep memory bounded under rotating clients.
            if len(self.entries) >= 10000:
                self.entries = defaultdict(deque, {k: v for k, v in self.entries.items() if v and v[-1] > now - window})
                if len(self.entries) >= 10000 and key not in self.entries:
                    raise HTTPException(429, "Too many requests; try again later", headers={"Retry-After": str(window)})
            bucket = self.entries[key]
            while bucket and bucket[0] <= now - window:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(429, "Too many requests; try again later", headers={"Retry-After": str(window)})
            bucket.append(now)


def auth_limit(request: Request):
    settings = request.app.state.settings
    ip = request.client.host if request.client else "unknown"
    request.app.state.limiter.check(("auth", ip), settings.auth_rate_limit, settings.auth_rate_window_seconds)


def public_user(user):
    return {key: user[key] for key in ("id", "name", "email", "timezone", "notifications_enabled")}


def current_user(request: Request, db=Depends(get_db)):
    token = request.cookies.get(request.app.state.settings.cookie_name)
    if not token or len(token) > 200:
        raise HTTPException(401, "Authentication required")
    session = db.sessions.find_one({"token_hash": digest(token), "expires_at": {"$gt": utcnow()}})
    user = db.users.find_one({"id": session["user_id"]}) if session else None
    if not user or session.get("auth_version", 0) != user.get("auth_version", 0):
        raise HTTPException(401, "Session expired; please log in")
    return user


def issue_session(request: Request, response: Response, db, user):
    settings = request.app.state.settings
    old = request.cookies.get(settings.cookie_name)
    if old:
        db.sessions.delete_one({"token_hash": digest(old)})
    token = secrets.token_urlsafe(48)
    expires = utcnow() + timedelta(hours=settings.session_hours)
    db.sessions.insert_one({"user_id": user["id"], "token_hash": digest(token), "expires_at": expires, "auth_version": user.get("auth_version", 0)})
    response.set_cookie(settings.cookie_name, token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_hours * 3600, expires=expires, path="/")
