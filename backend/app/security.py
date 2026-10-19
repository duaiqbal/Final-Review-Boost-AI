import hashlib
import hmac
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException, Request

from .config import settings


# ---------- Admin password ----------
# The configured password is hashed once at startup with a per-process random salt.
# Only the hash is kept in memory; the plaintext is never compared or stored by this module.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
_SALT = os.urandom(16)
_PW_HASH = None


def _derive(password: str) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=_SALT, **_SCRYPT)


def init_password_hash(plaintext: str) -> None:
    global _PW_HASH
    if not plaintext:
        raise RuntimeError("ADMIN_PASSWORD must not be empty.")
    _PW_HASH = _derive(plaintext)


def check_password(password: str) -> bool:
    if _PW_HASH is None:
        return False
    return hmac.compare_digest(_derive(password), _PW_HASH)


# ---------- Admin token ----------


def create_token() -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.TOKEN_HOURS)
    return jwt.encode({"sub": "admin", "exp": exp}, settings.JWT_SECRET, algorithm="HS256")


def require_admin(authorization: str = Header(default=None)) -> None:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Admin login required."})
    token = authorization.split(" ", 1)[1].strip()
    try:
        jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Session expired. Please log in again."})


# ---------- Simple in-memory rate limiter ----------
def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self.hits = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.time()
        q = self.hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            retry = int(self.window - (now - q[0])) + 1
            raise HTTPException(
                429,
                detail={"code": "rate_limited", "message": f"Too many requests. Try again in {retry} seconds."},
                headers={"Retry-After": str(retry)},
            )
        q.append(now)
