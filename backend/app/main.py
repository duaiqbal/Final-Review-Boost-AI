import io
import logging
import time
from contextlib import asynccontextmanager

import qrcode
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from qrcode.constants import ERROR_CORRECT_M

from . import database as db
from . import ai_service
from .ai_service import ai_configured, generate_review_draft
from .config import settings
from .guardrails import GuardrailError, ReviewContext, sanitize_comment, validate_answers
from .schemas import (ID_PATTERN, BusinessIn, EventIn, GenerateReviewIn, LoginIn, StatusIn)
from .security import (RateLimiter, check_password, client_ip, create_token,
                       init_password_hash, require_admin)
from .templates import all_templates

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("reviewboost")

login_limiter = RateLimiter(limit=5, window_seconds=60)
review_limiter = RateLimiter(limit=10, window_seconds=60)
event_limiter = RateLimiter(limit=30, window_seconds=60)

DISCLAIMER = (
    "This is an AI-generated draft based only on your answers. Please read it, edit it, "
    "and make sure it reflects your real experience before posting."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.ADMIN_PASSWORD or not settings.JWT_SECRET:
        raise RuntimeError("Set ADMIN_PASSWORD and JWT_SECRET in your .env file.")
    started = time.perf_counter()
    init_password_hash(settings.ADMIN_PASSWORD)
    db.init_db()
    log.info("ReviewBoost backend ready in %.0f ms (ai_configured=%s, frontend=%s)",
             (time.perf_counter() - started) * 1000, ai_configured(), settings.FRONTEND_BASE_URL)
    yield


app = FastAPI(title="ReviewBoost AI Backend", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def customer_url(business_id: str) -> str:
    return f"{settings.FRONTEND_BASE_URL}/review/{business_id}"


def with_links(business: dict) -> dict:
    business = dict(business)
    business["customer_url"] = customer_url(business["id"])
    business["qr_png_url"] = f"/api/qr/{business['id']}.png"
    return business


def public_view(business: dict) -> dict:
    keys = ["id", "name", "business_type", "logo_url", "brand_color", "welcome_message",
            "review_destination_url", "categories", "rating_options"]
    return {k: business[k] for k in keys}


# ---------- public-view cache ----------
# Customer pages read the same business on every scan. Cache the public view in memory
# for a short time; any admin write evicts the entry so status changes apply immediately.
PUBLIC_CACHE_TTL = 60.0
_public_cache: dict = {}


def cached_public_business(business_id: str) -> dict:
    hit = _public_cache.get(business_id)
    now = time.monotonic()
    if hit and hit[1] > now:
        business = hit[0]
    else:
        business = find_business_or_404(business_id)
        _public_cache[business_id] = (business, now + PUBLIC_CACHE_TTL)
    if business["status"] != "active":
        raise HTTPException(403, detail={"code": "business_inactive",
                                         "message": "This feedback page is currently not active."})
    return business


def evict_public(business_id: str) -> None:
    _public_cache.pop(business_id, None)


def find_business_or_404(business_id: str) -> dict:
    business = db.get_business(business_id)
    if not business:
        raise HTTPException(404, detail={"code": "not_found", "message": "This feedback page does not exist."})
    return business


# ============================== health ==============================
@app.get("/")
def root():
    return {
        "name": "ReviewBoost AI Backend",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    # frontend_base_url is public anyway (it is inside every QR code); exposing it lets ops
    # confirm QR codes point at the right site without logging in.
    return {"status": "ok", "ai_configured": ai_configured(), "model": settings.GEMINI_MODEL,
            "frontend_base_url": settings.FRONTEND_BASE_URL,
            "ai_last_error": ai_service.last_error or None,
            "ai_key_check": ai_service.key_fingerprint()}


# ============================== admin ==============================
@app.post("/api/admin/login")
def admin_login(body: LoginIn, request: Request):
    login_limiter.check(f"login:{client_ip(request)}")
    if not check_password(body.password):
        raise HTTPException(401, detail={"code": "bad_password", "message": "Incorrect password."})
    return {"token": create_token(), "expires_in_hours": settings.TOKEN_HOURS}


@app.get("/api/admin/templates", dependencies=[Depends(require_admin)])
def admin_templates():
    return all_templates()


@app.get("/api/admin/dashboard", dependencies=[Depends(require_admin)])
def admin_dashboard():
    return db.dashboard_stats()


@app.get("/api/admin/businesses", dependencies=[Depends(require_admin)])
def admin_list_businesses():
    return [with_links(b) for b in db.list_businesses()]


@app.post("/api/admin/businesses", status_code=201, dependencies=[Depends(require_admin)])
def admin_create_business(body: BusinessIn):
    return with_links(db.create_business(body.model_dump()))


@app.get("/api/admin/businesses/{business_id}", dependencies=[Depends(require_admin)])
def admin_get_business(business_id: str = Path(pattern=ID_PATTERN)):
    return with_links(find_business_or_404(business_id))


@app.put("/api/admin/businesses/{business_id}", dependencies=[Depends(require_admin)])
def admin_update_business(body: BusinessIn, business_id: str = Path(pattern=ID_PATTERN)):
    evict_public(business_id)
    updated = db.update_business(business_id, body.model_dump())
    if not updated:
        find_business_or_404(business_id)
    return with_links(updated)


@app.patch("/api/admin/businesses/{business_id}/status", dependencies=[Depends(require_admin)])
def admin_set_status(body: StatusIn, business_id: str = Path(pattern=ID_PATTERN)):
    evict_public(business_id)
    updated = db.set_status(business_id, body.status)
    if not updated:
        find_business_or_404(business_id)
    return with_links(updated)


@app.delete("/api/admin/businesses/{business_id}", status_code=204, dependencies=[Depends(require_admin)])
def admin_delete_business(business_id: str = Path(pattern=ID_PATTERN)):
    evict_public(business_id)
    if not db.delete_business(business_id):
        find_business_or_404(business_id)
    return Response(status_code=204)


# ============================== QR code ==============================
# Public on purpose: the QR only contains the public customer URL, and <img src> cannot send a token.
@app.get("/api/qr/{business_id}.png")
def qr_png(
    business_id: str = Path(pattern=ID_PATTERN),
    size: int = Query(default=10, ge=4, le=20),
    download: bool = False,
):
    find_business_or_404(business_id)
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=size, border=4)
    qr.add_data(customer_url(business_id))  # ReviewBoost page, NOT the Google link
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buf, format="PNG")
    headers = {"Cache-Control": "public, max-age=3600"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="qr_{business_id}.png"'
    return Response(content=buf.getvalue(), media_type="image/png", headers=headers)


# ============================== customer (public) ==============================
@app.get("/api/public/business/{business_id}")
def public_get_business(request: Request, business_id: str = Path(pattern=ID_PATTERN),
                        preview: bool = False):
    business = cached_public_business(business_id)
    if not preview:  # admin preview must not inflate visit counts
        db.log_event(business_id, "visit")
    return public_view(business)


@app.post("/api/public/business/{business_id}/generate-review")
def public_generate_review(body: GenerateReviewIn, request: Request,
                           business_id: str = Path(pattern=ID_PATTERN)):
    review_limiter.check(f"gen:{client_ip(request)}")
    business = cached_public_business(business_id)

    comment, warnings = sanitize_comment(body.comment)
    try:
        items = validate_answers(business, body.answers, comment)
    except GuardrailError as err:
        raise HTTPException(422, detail={"code": "invalid_feedback", "message": err.message,
                                         "missing": err.missing})

    ctx = ReviewContext(business["name"], business["business_type"], items, comment)
    result = generate_review_draft(ctx, regenerate=body.regenerate)
    db.log_event(business_id, "draft_generated")
    return {
        "review": result["review"],
        "source": result["source"],              # "ai" or "fallback"
        "fallback_reason": result["fallback_reason"],
        "warnings": warnings,
        "disclaimer": DISCLAIMER,
    }


@app.post("/api/public/business/{business_id}/events", status_code=204)
def public_event(body: EventIn, request: Request, business_id: str = Path(pattern=ID_PATTERN)):
    event_limiter.check(f"evt:{client_ip(request)}")
    cached_public_business(business_id)
    db.log_event(business_id, body.event)
    return Response(status_code=204)
