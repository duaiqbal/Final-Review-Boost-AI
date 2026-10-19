from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import main, security
from app.config import settings


def test_correct_and_wrong_password():
    security.init_password_hash("s3cret-pass")
    assert security.check_password("s3cret-pass")
    assert not security.check_password("s3cret-pasS")
    assert not security.check_password("")


def test_uninitialized_hash_rejects_everything():
    with patch.object(security, "_PW_HASH", None):
        assert not security.check_password("anything")


def test_hash_is_not_plaintext():
    security.init_password_hash("s3cret-pass")
    assert security._PW_HASH != b"s3cret-pass"
    assert len(security._PW_HASH) == 32


def test_empty_admin_password_fails_startup(temp_db):
    with patch.object(settings, "ADMIN_PASSWORD", ""):
        with pytest.raises(RuntimeError):
            with TestClient(main.app):
                pass


def test_login_wrong_then_right(client):
    assert client.post("/api/admin/login", json={"password": "nope"}).status_code == 401
    assert client.post("/api/admin/login", json={"password": "test-admin-pass"}).status_code == 200


def test_login_rate_limited(client):
    codes = [client.post("/api/admin/login", json={"password": "nope"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429
