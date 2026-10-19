# Final ReviewBoost AI

AI-powered, multi-business customer feedback and review-draft platform.

- **Live app:** https://review-bost-ai-frontend.vercel.app  (admin panel at `/admin`)
- **Backend API docs:** https://review-boost-ai-backend-production.up.railway.app/docs

## Repository layout

| Folder | Stack | Description |
| --- | --- | --- |
| `frontend/` | Next.js 16 + React 19 (Vercel) | Admin panel + customer 4-step review flow. See `frontend/README.md`. |
| `backend/` | FastAPI + Google Gemini + SQLite (Railway) | REST API, JWT admin auth, QR PNGs, AI drafts with 3-layer guardrails, event tracking. See `backend/README.md`. |

## How it works

1. An admin creates a business and customises its feedback form, then shares a QR code.
2. A customer scans the QR, which opens the ReviewBoost customer page (never the Google link directly).
3. The customer gives ratings and an optional comment; the backend generates a review draft with Gemini, guarded so it never invents facts or upgrades low ratings. If AI is unavailable, a safe ratings-only fallback is used.
4. The customer edits the draft, then copies it and opens the external review page to post it themselves.

## Quick start

See `frontend/README.md` and `backend/README.md` for full setup, environment variables, tests and deployment.

## Documentation

- `frontend/docs/DEFENSE.md` - current status, architecture, AI safety, verified test & performance results, demo script, examiner Q&A.
- `frontend/docs/BLUEPRINT_CHECK.md` - problem statement vs implementation, item by item.

## Status

The full flow is live and verified. AI drafts currently use the safe fallback because the Railway `GEMINI_API_KEY` is invalid; set a valid key to enable real Gemini drafts (details at the top of `frontend/docs/DEFENSE.md`).
