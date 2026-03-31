# Deep Code Review — GA Equipment Control

Date: 2026-03-31
Scope: `index.html` (single-page app with Supabase direct client calls)

## Executive Summary

This app is functional and UX-forward, but architecture and data-access controls currently create **serious security and data consistency risks**. The highest-priority work is to move privileged operations behind Supabase RLS + server-side authorization boundaries (or Edge Functions), then make inventory updates atomic.

## Findings (Prioritized)

### 1) Critical — Client-side authorization can be bypassed
- The front-end sends role hints (`ga`/`mgr`) and directly decides which table to query (`ga_staff` vs `managers`) and which data actions are allowed.
- All CRUD operations are initiated from the browser through the same anon client.
- Impact: an attacker can call the same APIs from DevTools and attempt manager-grade actions if backend policies are weak/misconfigured.

**Evidence**
- Role-selected auth table logic and direct PIN verification in client: lines 663-669.
- Manager actions callable directly from client API wrapper (equipment/user CRUD): lines 714-747.
- Role used from UI state in requests (`params.role`): lines 683, 738-739, 745-746.

**Recommendation**
- Enforce all authorization in Supabase RLS and/or move privileged actions to Edge Functions.
- Treat client role value as untrusted input; derive privileges from JWT claims only.

### 2) Critical — Inventory updates are non-atomic (race conditions)
- Borrow flow inserts a record and then separately reads+updates stock.
- Return flow updates borrow status and then separately reads+updates stock.
- These are multi-step operations without transaction boundaries.
- Impact: concurrent requests can oversubscribe stock or produce inconsistent `available` counts.

**Evidence**
- Borrow split operation: lines 689-699.
- Return split operation: lines 702-712.

**Recommendation**
- Use a single SQL transaction / RPC function to perform validation + mutation atomically.
- Add server-side constraints (`available >= 0`, `available <= quantity`) and retry logic.

### 3) High — Authentication model is weak for production
- PIN verification and hash migration logic run in client code.
- Legacy plain PIN support still exists (`stored===input`) then auto-migrates.
- Impact: auth behavior can be probed client-side; migration branch may hide poor data hygiene.

**Evidence**
- Client-side SHA-256 hashing: lines 585-586.
- Verify PIN and plaintext fallback migration: lines 666-669.
- PIN lockout is local in memory only (`PIN_ATTEMPTS`, `PIN_LOCKED_UNTIL`): lines 560-561, 875-878.

**Recommendation**
- Move auth checks server-side.
- Remove plaintext fallback after one-time migration script at DB layer.
- Persist lockout/rate-limiting server-side per user/IP/device fingerprint.

### 4) High — Record identity keyed by mutable/non-unique `name`
- Updates/deletes for users are based on `name` equality.
- UI prevents duplicates locally, but server trust should not rely on that.
- Impact: name collision or rename can delete/reset wrong account.

**Evidence**
- User insert/delete/update filters by `name`: lines 740, 746, 674.
- UI duplicate check only in client memory: line 1420.

**Recommendation**
- Introduce immutable user IDs (UUID) and use IDs for all writes.
- Add unique constraints in DB schema for login identity fields.

### 5) Medium — Overdue status mutates only local objects, not persisted
- `detectOverdue` rewrites in-memory `r.status = 'overdue'` without DB update.
- Impact: inconsistent status across sessions/clients and reporting ambiguity.

**Evidence**
- Local mutation logic: lines 643-651.
- Called after reading borrows: line 685.

**Recommendation**
- Compute overdue as derived state at query time (preferred), or persist via scheduled backend job.

### 6) Medium — Inline event handlers + extensive `innerHTML` increase maintenance and XSS blast radius
- Large-scale templating via string interpolation and `innerHTML` in many views.
- Escaping helper `he()` is used frequently (good), but safety depends on perfect, consistent usage.
- Impact: future changes can accidentally introduce injection vectors.

**Evidence**
- Escape helper: line 583.
- Multiple `innerHTML` render blocks: lines 951, 989, 1071, 1109, 1167, 1213, 1265, 1298, 1387.
- Inline `onclick` usage across markup and templates (many instances).

**Recommendation**
- Move to delegated event listeners and safer DOM creation APIs (`createElement`, `textContent`) for dynamic regions.
- If staying string-based, centralize template rendering with strict escaping utilities and lint rules.

### 7) Medium — Single-file architecture hurts testability and change safety
- UI, state, data access, and rendering all in one large HTML file.
- Impact: high regression risk, difficult onboarding/review, weak unit-test surface.

**Evidence**
- Entire app logic resides in one script block spanning most of `index.html`.

**Recommendation**
- Split into modules: `api.js`, `auth.js`, `state.js`, `views/*`, `utils/*`.
- Add basic test harness for pure functions (formatting, validators, status calculations).

## Positive Notes
- Good user input escaping helper exists and is used in many critical render points.
- Signature capture UX includes explicit confirmation steps for submit actions.
- Loading/error states and retry UX are present.

## Suggested Remediation Roadmap
1. **Security first (P0)**: lock down RLS policies + move manager-sensitive mutations to server-side functions.
2. **Consistency (P0)**: atomic borrow/return stock updates via RPC transaction.
3. **Identity hardening (P1)**: migrate user operations from `name` to immutable IDs.
4. **Auth hardening (P1)**: remove client plaintext migration branch and enforce server-side rate limits.
5. **Maintainability (P2)**: modularize code and reduce `innerHTML`/inline handlers.
