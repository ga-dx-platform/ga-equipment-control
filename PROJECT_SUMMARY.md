# PROJECT_SUMMARY

## Project context (from prior scan)
- Frontend is a single-file SPA in `index.html` (vanilla JS + Tailwind CDN + Supabase JS).
- Data/backend uses Supabase Postgres with SQL migrations in `database/migrations/`.
- One Supabase Edge Function exists at `supabase/functions/send-weekly-report/index.ts`.
- Current style is client-heavy logic with a central `api(action, params)` dispatcher and tab-specific render functions.

## Development rules

### 1) Where to add features
- **UI screens / interactions:** add in `index.html`, near the relevant tab module (`renderBorrowTab`, `renderReturnTab`, `renderEquipmentTab`, etc.).
- **Data operations:** extend the existing `api(action, params)` switch/if chain instead of creating parallel data-access layers.
- **Schema/data model changes:** add a new numbered SQL migration in `database/migrations/` (never edit old applied migrations in-place).
- **Automations/server-side jobs:** add/update Supabase Edge Functions under `supabase/functions/`.

### 2) Patterns to follow
- Keep role-based behavior consistent (`ga` vs `mgr`) in both UI and query filtering.
- Reuse existing helpers for UX/state flow (toast, modal, cache, tab switching, audit logging).
- Preserve compatibility paths where code supports both new and legacy IDs (`id` and `eq_id`) unless explicitly migrating all data.
- Keep writes auditable: for meaningful user actions, continue logging to `app_audit_logs` via `logAction(...)`.
- Keep migrations idempotent/safe where possible (`if exists` / `if not exists` patterns).

### 3) What to avoid breaking
- **Auth/session flow:** user selection → PIN verify → lockout/auto-logout behavior.
- **Inventory consistency:** borrow/return must keep `equipment.available` aligned with borrow status changes.
- **RLS assumptions used by app:** app currently operates with anon-role access patterns; policy changes must be coordinated with app auth strategy.
- **Reporting flow:** `report_recipients` management and weekly report Edge Function contract.
- **Single-page navigation behavior:** tab switching and screen transitions should remain predictable and fast.

## Guardrails for future changes
- Prefer incremental changes matching current architecture over large rewrites.
- If introducing refactors, keep behavior identical first, then optimize in separate steps.
- Avoid adding a build system/framework unless explicitly requested.
