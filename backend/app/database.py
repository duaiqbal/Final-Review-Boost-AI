import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_conn():
    conn = sqlite3.connect(settings.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS businesses (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                business_type TEXT NOT NULL,
                logo_url TEXT,
                brand_color TEXT NOT NULL,
                welcome_message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                review_destination_url TEXT,
                categories_json TEXT NOT NULL,
                rating_options_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                business_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_events_business
                ON events(business_id, event_type);
            """
        )


def _normalize_categories(categories: list) -> list:
    """Give every category a stable unique id (kept on edit, created when new)."""
    used = set()
    out = []
    for cat in categories:
        cid = cat.get("id")
        if not cid or cid in used:
            cid = "cat_" + secrets.token_hex(3)
        used.add(cid)
        out.append(
            {
                "id": cid,
                "name": cat["name"],
                "description": cat.get("description", ""),
                "required": bool(cat.get("required", True)),
            }
        )
    return out  # list order == display order (reorder = send a reordered list)


def _row_to_business(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "business_type": row["business_type"],
        "logo_url": row["logo_url"],
        "brand_color": row["brand_color"],
        "welcome_message": row["welcome_message"],
        "status": row["status"],
        "review_destination_url": row["review_destination_url"],
        "categories": json.loads(row["categories_json"]),
        "rating_options": json.loads(row["rating_options_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_business(data: dict) -> dict:
    bid = "biz_" + secrets.token_hex(5)
    now = _now()
    with get_conn() as c:
        c.execute(
            """INSERT INTO businesses (id, name, business_type, logo_url, brand_color,
               welcome_message, status, review_destination_url, categories_json,
               rating_options_json, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                bid, data["name"], data["business_type"], data["logo_url"],
                data["brand_color"], data["welcome_message"], data["status"],
                data["review_destination_url"],
                json.dumps(_normalize_categories(data["categories"])),
                json.dumps(data["rating_options"]), now, now,
            ),
        )
    return get_business(bid)


def get_business(bid: str):
    with get_conn() as c:
        row = c.execute("SELECT * FROM businesses WHERE id = ?", (bid,)).fetchone()
    return _row_to_business(row) if row else None


def list_businesses() -> list:
    with get_conn() as c:
        rows = c.execute("SELECT * FROM businesses ORDER BY created_at DESC").fetchall()
    return [_row_to_business(r) for r in rows]


def update_business(bid: str, data: dict):
    with get_conn() as c:
        cur = c.execute(
            """UPDATE businesses SET name=?, business_type=?, logo_url=?, brand_color=?,
               welcome_message=?, status=?, review_destination_url=?, categories_json=?,
               rating_options_json=?, updated_at=? WHERE id=?""",
            (
                data["name"], data["business_type"], data["logo_url"],
                data["brand_color"], data["welcome_message"], data["status"],
                data["review_destination_url"],
                json.dumps(_normalize_categories(data["categories"])),
                json.dumps(data["rating_options"]), _now(), bid,
            ),
        )
        if cur.rowcount == 0:
            return None
    return get_business(bid)


def set_status(bid: str, status: str):
    with get_conn() as c:
        cur = c.execute(
            "UPDATE businesses SET status=?, updated_at=? WHERE id=?",
            (status, _now(), bid),
        )
        if cur.rowcount == 0:
            return None
    return get_business(bid)


def delete_business(bid: str) -> bool:
    with get_conn() as c:
        cur = c.execute("DELETE FROM businesses WHERE id=?", (bid,))
        return cur.rowcount > 0


def log_event(bid: str, event_type: str) -> None:
    with get_conn() as c:
        c.execute(
            "INSERT INTO events (business_id, event_type, created_at) VALUES (?,?,?)",
            (bid, event_type, _now()),
        )


def dashboard_stats() -> dict:
    with get_conn() as c:
        total = c.execute("SELECT COUNT(*) FROM businesses").fetchone()[0]
        active = c.execute(
            "SELECT COUNT(*) FROM businesses WHERE status='active'"
        ).fetchone()[0]
        totals = {
            r["event_type"]: r["n"]
            for r in c.execute(
                "SELECT event_type, COUNT(*) AS n FROM events GROUP BY event_type"
            )
        }
        per_business = [
            dict(r)
            for r in c.execute(
                """SELECT b.id, b.name, b.status,
                   COALESCE(SUM(CASE WHEN e.event_type='visit' THEN 1 ELSE 0 END),0) AS visits,
                   COALESCE(SUM(CASE WHEN e.event_type='draft_generated' THEN 1 ELSE 0 END),0) AS drafts_generated,
                   COALESCE(SUM(CASE WHEN e.event_type='copy_and_open_clicked' THEN 1 ELSE 0 END),0) AS copy_and_open_clicks
                   FROM businesses b LEFT JOIN events e ON e.business_id = b.id
                   GROUP BY b.id ORDER BY b.created_at DESC"""
            )
        ]
        recent = [
            dict(r)
            for r in c.execute(
                """SELECT e.event_type, e.created_at, b.name AS business_name
                   FROM events e JOIN businesses b ON b.id = e.business_id
                   ORDER BY e.id DESC LIMIT 10"""
            )
        ]
    return {
        "total_businesses": total,
        "active_businesses": active,
        "total_visits": totals.get("visit", 0),
        "drafts_generated": totals.get("draft_generated", 0),
        "copy_and_open_clicks": totals.get("copy_and_open_clicked", 0),
        "per_business": per_business,
        "recent_activity": recent,
        "note": "Counts are real tracked events. 'Copy & Open' clicks do not prove a review was published.",
    }
