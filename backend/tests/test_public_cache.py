from unittest.mock import patch

from app import database as db
from app import main
from tests.conftest import sample_business


def _create(client, auth, **kw):
    return client.post("/api/admin/businesses", json=sample_business(**kw), headers=auth).json()


def test_second_read_within_ttl_skips_db(client, auth):
    biz = _create(client, auth)
    calls = []
    real = db.get_business
    with patch.object(db, "get_business", side_effect=lambda bid: calls.append(bid) or real(bid)):
        assert client.get(f"/api/public/business/{biz['id']}").status_code == 200
        assert client.get(f"/api/public/business/{biz['id']}").status_code == 200
    assert calls == [biz["id"]]


def test_expired_entry_rereads(client, auth):
    biz = _create(client, auth)
    client.get(f"/api/public/business/{biz['id']}")
    cached, _ = main._public_cache[biz["id"]]
    main._public_cache[biz["id"]] = (cached, 0.0)
    calls = []
    real = db.get_business
    with patch.object(db, "get_business", side_effect=lambda bid: calls.append(bid) or real(bid)):
        client.get(f"/api/public/business/{biz['id']}")
    assert calls == [biz["id"]]


def test_status_change_evicts_immediately(client, auth):
    biz = _create(client, auth)
    assert client.get(f"/api/public/business/{biz['id']}").status_code == 200
    client.patch(f"/api/admin/businesses/{biz['id']}/status", json={"status": "inactive"}, headers=auth)
    r = client.get(f"/api/public/business/{biz['id']}")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "business_inactive"


def test_update_and_delete_evict(client, auth):
    biz = _create(client, auth)
    client.get(f"/api/public/business/{biz['id']}")
    client.put(f"/api/admin/businesses/{biz['id']}", json=sample_business(name="Renamed Cafe"), headers=auth)
    assert client.get(f"/api/public/business/{biz['id']}").json()["name"] == "Renamed Cafe"
    client.delete(f"/api/admin/businesses/{biz['id']}", headers=auth)
    assert client.get(f"/api/public/business/{biz['id']}").status_code == 404


def test_visits_counted_on_cache_hits_and_not_in_preview(client, auth):
    biz = _create(client, auth)
    client.get(f"/api/public/business/{biz['id']}")
    client.get(f"/api/public/business/{biz['id']}")
    client.get(f"/api/public/business/{biz['id']}?preview=true")
    assert client.get("/api/admin/dashboard", headers=auth).json()["total_visits"] == 2
