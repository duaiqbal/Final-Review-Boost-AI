# Blueprint check: does ReviewBoost AI meet the problem statement?

Status key: **Done** = implemented and checked in code/tests · **Partial** = works with a stated limit · **Later** = listed by the blueprint as a later-version feature, or deliberately out of MVP scope.

"Live" means checked against the deployed site with a temporary test business that was deleted afterwards.

## 1. Two separate panels

| Requirement | Status | Where |
| --- | --- | --- |
| Admin panel and customer panel are separate routes | Done | `/admin` vs `/review/{id}` |
| Customer page shows no admin controls | Done | customer page only imports public API calls |
| Panels connected only through the saved business configuration | Done | QR → `/review/{id}` → `GET /api/public/business/{id}` |

## 2. Admin panel

| Requirement | Status | Notes |
| --- | --- | --- |
| A. Dashboard: total businesses, active, recent activity, quick actions | Done | Counts plus visits / drafts / Copy & Open clicks and a recent-activity list. All numbers come from tracked events; the UI states that Copy & Open does not prove a review was published. |
| "Feedback submissions" count | Partial | Counted as "drafts generated". Ratings and comments are **not stored** (privacy by design, see §5). |
| B. Multi-business management | Done | Create / select / edit / delete any number of businesses |
| Name, type, logo URL, brand colour, welcome message, status, unique ID | Done | ID is server-generated (`biz_` + random hex) |
| C. Form builder: add / edit / delete / reorder categories, descriptions, required flags | Done | |
| Add / edit / remove / reorder rating options | Done | Reorder added in this pass |
| Preview the form before sharing the QR | Done | "Preview customer page" opens `/review/{id}?preview=true` (does not count visits). Shows the last **saved** version; an "unsaved changes" notice is shown. |
| Starting templates (restaurant, salon, hotel, software agency) | Done | Quick-template buttons |
| D. Customers can report average or poor experiences | Done | Every rating option is always shown; the AI guardrails keep low ratings in the draft |
| E. Review destination, validated http/https only | Done | `safe_http_url` in backend schemas; tested with `javascript:` |
| F. QR generated immediately after save; encodes the ReviewBoost URL, not Google | Done | Backend PNG endpoint; test decodes the PNG and asserts `{FRONTEND_BASE_URL}/review/{id}`. Live `/health` reports the correct `frontend_base_url`. |
| G. Live preview reflecting saved settings | Done | see C |
| H. View / download PNG / copy URL / activate-deactivate / test before printing | Done | Copy URL added in this pass |
| H. "Regenerate or replace a QR" | Partial | The QR is derived from the stable business ID, so it never needs regenerating when settings change. To retire a QR, deactivate or delete the business. |
| Editing questions does not require reprinting | Done | QR holds only the stable URL |
| Admin authentication | Partial | One admin password (scrypt-hashed at startup) + 12 h JWT. No per-staff accounts (blueprint lists this as a later feature). |

## 3. Customer panel

| Requirement | Status | Notes |
| --- | --- | --- |
| Screen 1 Welcome: logo, name, welcome message, Start button that navigates | Done | Rebuilt in this pass as a real step |
| Screen 2: admin-configured categories and ratings, clear selection, optional comment | Done | `aria-pressed` on options, progress bar |
| Required-question validation that names what is missing | Done | Client-side and server-side (`missing` list) |
| Screen 3: editable draft, Regenerate, Copy, Back, "this is a draft" | Done | Copy and Back added in this pass |
| AI must not invent staff/products/prices/events and must keep negative ratings | Done | Prompt rules + output guardrails + fallback; 8 property tests |
| Screen 4: copy, open destination, completion message, explain the customer must paste and submit | Done | Completion screen says the review is only published after the customer submits it |
| Clipboard blocked → manual copy | Done | Falls back to selecting the text |
| Missing destination → explain, do not open an invalid link | Done | |
| Never claims the review was published | Done | |
| Cold start / slow server | Done | "Waking up the server" message after 2.5 s, automatic retry on network errors |

## 4. Communication and isolation

| Requirement | Status | Notes |
| --- | --- | --- |
| One business's settings never shown to another | Done | Public view is fetched by ID; answers are validated against **that** business's categories and ratings (`validate_answers`); cache keyed by ID; tested |

## 5. Storage and privacy

| Data | Stored? |
| --- | --- |
| Business profile, form, destination, QR identifier | SQLite database |
| Admin account | Password in env var (hashed in memory), JWT sessions |
| Analytics | Event rows only: `visit`, `draft_generated`, `copy_and_open_clicked` with timestamp and business ID |
| Customer ratings, comments, AI drafts | **Not stored** |
| Customer name, email, phone | Never requested; contact details typed into comments are stripped before AI |

## 6. Architecture versus the blueprint

The blueprint suggests Next.js API routes + Supabase. This project uses **Next.js frontend + a separate FastAPI backend + SQLite**. Same responsibilities: the AI key stays on the server, validation runs server-side, configuration is persisted. Trade-offs are explained in `DEFENSE.md`. Moving to Postgres/Supabase is the planned scale-up path.

## 7. Definition of success

| Test from the blueprint | Status |
| --- | --- |
| Admin creates a business and customises its form | **PASS** live (API) |
| QR appears immediately and can be downloaded | **PASS** live: PNG served, download header, decoded URL = `/review/{id}` |
| Scanning on another phone opens the correct customer page | Decoded live QR URL opened in a phone-size Chrome: **PASS**. Real phone camera: NOT TESTED |
| Changing the business's settings updates its customer form | **PASS** live (renamed question visible immediately in browser) |
| Customer selects ratings, submits, edits AI draft | **PASS** live in browser, but drafts came from the fallback because the Gemini key is invalid |
| Copy and redirect with clear error handling | **PASS** live in browser (clipboard verified, new tab = destination, honest done screen) |
| One business's settings never leak into another | **PASS** live (other business's question rejected with 422) |
| Works on desktop and mobile without broken layout | **PASS** in Chrome at 390×844 and 1366×900 (no overflow); real devices: NOT TESTED |
