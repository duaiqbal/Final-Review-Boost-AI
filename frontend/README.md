# ReviewBoost AI — Frontend

Next.js 16 (React 19) app with two panels:

- **Admin panel** (`/admin`): password login, multi-business management, feedback-form builder (questions, descriptions, required flags, rating options with reorder), review destination, QR code (view, download PNG, copy URL, preview), activate/deactivate, and a dashboard of real tracked events.
- **Customer panel** (`/review/{business_id}`): opened by scanning the QR. Four steps: Welcome, Feedback, AI draft (edit, regenerate, copy), Copy & open review page.

All data and AI calls go through the FastAPI backend ([Review-Boost-AI-Backend](https://github.com/naseemshigreee/Review-Boost-AI-Backend)). The frontend holds no secrets.

Live: https://review-bost-ai-frontend.vercel.app · Backend API docs: https://review-boost-ai-backend-production.up.railway.app/docs

## Setup

```bash
npm install
```

Optional `.env.local`:

```
NEXT_PUBLIC_API_URL=https://review-boost-ai-backend-production.up.railway.app
```

If unset, `lib/api.ts` defaults to the production backend. For a local backend use `http://127.0.0.1:8000` and add `http://localhost:3000` to the backend `ALLOWED_ORIGINS`.

## Run, check, build

| Task | macOS / Linux / Vercel | Windows |
| --- | --- | --- |
| Dev server | `npm run dev` | `npm run dev:win` |
| Lint | `npm run lint` | same |
| Type-check | `npm run typecheck` | same |
| Production build | `npm run build` (Turbopack) | `npm run build:win` (webpack) |

Windows needs the `:win` scripts because the Turbopack native SWC binary does not load on that machine; webpack works.

> This project uses Next.js 16, which has breaking changes compared with older versions. Read `node_modules/next/dist/docs/` before changing Next.js-specific code (see `AGENTS.md`).

## Deploy (Vercel)

1. Import this repo in Vercel (framework: Next.js, default build command).
2. Optionally set `NEXT_PUBLIC_API_URL` for Production and Preview.
3. Push to `main`; Vercel deploys automatically.
4. In the backend (Railway) set `FRONTEND_BASE_URL` to this Vercel URL and add it to `ALLOWED_ORIGINS`. QR codes encode `FRONTEND_BASE_URL/review/{id}`, so a wrong value makes every QR open the wrong site. Check it with `GET {backend}/health`, field `frontend_base_url`.

## Structure

```
app/admin/page.tsx               admin panel
app/review/[businessId]/page.tsx customer 4-step flow
app/layout.tsx                   root layout, self-hosted Inter font (next/font)
lib/api.ts                       typed API client, APIError, abort support
docs/DEFENSE.md                  architecture, AI safety, results, demo script, examiner Q&A
docs/BLUEPRINT_CHECK.md          blueprint requirement-by-requirement status
```
