# ReviewBoost AI — Backend

FastAPI service for ReviewBoost AI: business configuration (SQLite), admin auth (JWT), QR code PNGs, AI review drafts (Google Gemini) with three-layer guardrails, and event tracking.

Live: https://review-boost-ai-backend-production.up.railway.app (`/docs` for the OpenAPI UI, `/health` for status)
Frontend: [Review-Bost-AI-frontend](https://github.com/naseemshigreee/Review-Bost-AI-frontend)

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
copy .env.example .env            # then edit the values
python -m uvicorn app.main:app --reload
```

The API then runs on `http://127.0.0.1:8000` (docs at `/docs`).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes | Admin login. Hashed with scrypt at startup; the app refuses to start if it is empty. |
| `JWT_SECRET` | yes | Signs admin tokens (12 h). Generate with `python -c "import secrets; print(secrets.token_hex(32))"`. |
| `GEMINI_API_KEY` | no | Without it, drafts use the safe non-AI fallback. |
| `GEMINI_MODEL` | no | Default `gemini-2.5-flash`. |
| `FRONTEND_BASE_URL` | yes | Encoded in every QR code as `{FRONTEND_BASE_URL}/review/{id}`. Production: `https://review-bost-ai-frontend.vercel.app`. |
| `ALLOWED_ORIGINS` | yes | CORS allow-list, comma separated. Include the Vercel URL and `http://localhost:3000`. |
| `DATABASE_PATH` | no | SQLite file. On Railway put it on a mounted volume (for example `/data/reviewboost.db`) or data is lost on every redeploy. |

Never commit `.env`.

## API overview

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/health` | public: status, `ai_configured`, model, `frontend_base_url` |
| POST | `/api/admin/login` | public, 5 per minute per IP |
| GET | `/api/admin/dashboard`, `/api/admin/templates`, `/api/admin/businesses` | Bearer JWT |
| POST / GET / PUT / DELETE | `/api/admin/businesses[/{id}]` | Bearer JWT |
| PATCH | `/api/admin/businesses/{id}/status` | Bearer JWT |
| GET | `/api/qr/{id}.png` (`?download=true`, `size=4..20`) | public (the QR only holds the public page URL) |
| GET | `/api/public/business/{id}` (`?preview=true`) | public; 60 s in-memory cache, evicted on admin edits |
| POST | `/api/public/business/{id}/generate-review` | public, 10 per minute per IP |
| POST | `/api/public/business/{id}/events` | public, 30 per minute per IP |

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

29 tests: 8 Hypothesis property tests at 100 examples each (create/read round-trip, stable category IDs, prompt-injection removal, rejection of contact details, invented details and sentiment upgrades, AI-failure fallback, idempotent status), cache and eviction, password hashing, rate limits, the full API flow, edge cases, CORS, and decoding the QR PNG with OpenCV to assert it equals `{FRONTEND_BASE_URL}/review/{id}`. Tests run offline: Gemini is mocked or disabled.

## Deploy (Railway)

The start command is in `railpack.json`. Set the variables above, attach a volume for `DATABASE_PATH`, and push to `main`.

## Known limits

- SQLite on one instance: fine for a demo or a small business; use Postgres for multi-instance scale.
- The rate limiter and public cache are in memory (reset on restart, per instance).
- One admin password; no per-business staff accounts yet.
