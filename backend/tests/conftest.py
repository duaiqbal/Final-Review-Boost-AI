"""Shared fixtures. Env vars are set BEFORE the app is imported because Settings reads them at import."""
import os

os.environ["ADMIN_PASSWORD"] = "test-admin-pass"
os.environ["JWT_SECRET"] = "test-jwt-secret-not-for-production"
os.environ["GEMINI_API_KEY"] = ""  # keep tests offline; AI path is exercised with mocks
os.environ["FRONTEND_BASE_URL"] = "https://review-bost-ai-frontend.vercel.app"
os.environ["ALLOWED_ORIGINS"] = "https://review-bost-ai-frontend.vercel.app,http://localhost:3000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import database as db  # noqa: E402
from app import main  # noqa: E402
from app.config import settings  # noqa: E402


def reset_state():
    main._public_cache.clear()
    for limiter in (main.login_limiter, main.review_limiter, main.event_limiter):
        limiter.hits.clear()


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_PATH", str(tmp_path / "test.db"))
    db.init_db()
    reset_state()
    yield


@pytest.fixture
def client(temp_db):
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def auth(client):
    r = client.post("/api/admin/login", json={"password": "test-admin-pass"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def sample_business(**overrides):
    data = {
        "name": "Bluebird Cafe",
        "business_type": "Restaurant / Cafe",
        "logo_url": None,
        "brand_color": "#4F46E5",
        "welcome_message": "Tell us about your visit.",
        "status": "active",
        "review_destination_url": "https://maps.google.com/bluebird",
        "categories": [
            {"name": "Food Quality", "description": "", "required": True},
            {"name": "Service", "description": "", "required": True},
            {"name": "Ambience", "description": "", "required": False},
        ],
        "rating_options": [
            {"label": "Excellent", "score": 4}, {"label": "Good", "score": 3},
            {"label": "Average", "score": 2}, {"label": "Poor", "score": 1},
        ],
    }
    data.update(overrides)
    return data
