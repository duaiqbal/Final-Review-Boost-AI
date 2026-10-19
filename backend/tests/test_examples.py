from app.guardrails import sanitize_comment
from tests.conftest import sample_business


def test_empty_comment():
    assert sanitize_comment("") == ("", [])
    assert sanitize_comment("   ") == ("", [])


def test_contact_details_stripped_with_warning():
    text, warnings = sanitize_comment("Great tea, call +92 300 1234567 or mail a@b.com")
    assert "1234567" not in text and "a@b.com" not in text and "Great tea" in text
    assert warnings == ["Links and contact details were removed from your comment."]


def _setup(client, auth):
    biz = client.post("/api/admin/businesses", json=sample_business(), headers=auth).json()
    pub = client.get(f"/api/public/business/{biz['id']}").json()
    return biz, pub


def test_copy_event_counted_twice(client, auth):
    biz, _ = _setup(client, auth)
    for _ in range(2):
        assert client.post(f"/api/public/business/{biz['id']}/events",
                           json={"event": "copy_and_open_clicked"}).status_code == 204
    assert client.get("/api/admin/dashboard", headers=auth).json()["copy_and_open_clicks"] == 2


def test_regenerate_returns_draft(client, auth):
    biz, pub = _setup(client, auth)
    answers = [{"category_id": pub["categories"][0]["id"], "rating": "Good"},
               {"category_id": pub["categories"][1]["id"], "rating": "Average"}]
    r = client.post(f"/api/public/business/{biz['id']}/generate-review",
                    json={"answers": answers, "comment": "", "regenerate": True})
    assert r.status_code == 200 and r.json()["review"]


def test_ai_error_is_redacted_on_health(client):
    from unittest.mock import patch
    from app import ai_service
    from app.config import settings
    key = "AIzaSyTESTKEYTESTKEYTESTKEY123456789"
    with patch.object(settings, "GEMINI_API_KEY", key):
        ai_service._record_error(RuntimeError(f"404 model not found for key {key}"))
    err = client.get("/health").json()["ai_last_error"]
    assert err["type"] == "RuntimeError" and key not in err["message"] and "[redacted]" in err["message"]
    ai_service.last_error.clear()


def test_key_cleanup_and_fingerprint():
    from unittest.mock import patch
    from app import ai_service
    from app.config import _clean_secret, settings
    k = "AIzaSyTESTKEYTESTKEYTESTKEY123456789"
    assert _clean_secret(f'  "{k}" ') == k
    assert _clean_secret(f"GEMINI_API_KEY={k}") == k
    with patch.object(settings, "GEMINI_API_KEY", k):
        fp = ai_service.key_fingerprint()
    assert fp == {"present": True, "length": len(k), "starts_with_AIza": True, "last4": "6789"}
    assert k not in str(fp)


def test_fatal_key_error_falls_back_without_wasting_attempts():
    """A 401-style error must fall back immediately, not burn all retry attempts."""
    from unittest.mock import patch
    from app import ai_service
    from app.config import settings
    from app.guardrails import RatedItem, ReviewContext

    ctx = ReviewContext("Cafe", "Cafe", [RatedItem("Service", "", "Good", 3, "positive")], "")
    calls = {"n": 0}

    class FatalErr(Exception):
        code = 401

    def fake(prompt, regen, model):
        calls["n"] += 1
        raise FatalErr("401 API key not valid")

    with patch.object(settings, "GEMINI_API_KEY", "AIzaFAKE"), \
         patch.object(settings, "GEMINI_FALLBACK_MODEL", ""), \
         patch.object(ai_service, "_call_gemini", side_effect=fake):
        result = ai_service.generate_review_draft(ctx)
    assert result["source"] == "fallback"
    assert result["fallback_reason"] == "ai_unavailable"
    assert calls["n"] == 1  # stopped after the first fatal error


def test_fatal_error_tries_fallback_model_once():
    from unittest.mock import patch
    from app import ai_service
    from app.config import settings
    from app.guardrails import RatedItem, ReviewContext

    ctx = ReviewContext("Cafe", "Cafe", [RatedItem("Service", "", "Good", 3, "positive")], "")
    seen = []

    class FatalErr(Exception):
        code = 404

    def fake(prompt, regen, model):
        seen.append(model)
        if model == "primary-model":
            raise FatalErr("404 model not found")
        return '{"review": "I visited Cafe and the Service was good."}'

    with patch.object(settings, "GEMINI_API_KEY", "AIzaFAKE"), \
         patch.object(settings, "GEMINI_MODEL", "primary-model"), \
         patch.object(settings, "GEMINI_FALLBACK_MODEL", "backup-model"), \
         patch.object(ai_service, "_call_gemini", side_effect=fake):
        result = ai_service.generate_review_draft(ctx)
    assert seen == ["primary-model", "backup-model"]
    assert result["source"] == "ai"


def test_is_fatal_classification():
    from app import ai_service

    class E(Exception):
        def __init__(self, msg, code=None):
            super().__init__(msg)
            self.code = code
    assert ai_service._is_fatal(E("bad", 401))
    assert ai_service._is_fatal(E("API key not valid"))
    assert not ai_service._is_fatal(E("503 service unavailable", 503))
    assert not ai_service._is_fatal(E("timeout"))
