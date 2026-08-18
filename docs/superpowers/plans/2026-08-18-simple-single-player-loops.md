# Simple Single-Player Loops Implementation Plan

**Goal:** Make every shipped single-player sidebar activity startable through the same low-friction region/category -> target -> infinite-idle interaction used by Milky Way Idle.

**Architecture:** Keep the existing authoritative queue and settlement engine. Remove tutorial-only authorization, derive pre-foundation realm stages from cultivation XP consistently, expose combat monsters as normal infinite queue actions, and reduce the expedition UI to a queue-backed map/monster picker. Hide unfinished non-network placeholder pages from primary navigation while preserving direct routes.

**Tech Stack:** TypeScript, NestJS, PostgreSQL, React, TanStack Query, React Router, Vitest, Playwright.

---

### Task 1: Restore the natural progression unlock chain

**Files:**
- Modify: `packages/game-rules/src/index.ts`
- Modify: `apps/api/src/content/content.service.ts`
- Modify: `apps/api/src/queue/queue.service.ts`
- Modify: affected service tests

1. Add failing tests for XP-derived mortal/qi stages without auto-entering foundation.
2. Add failing content tests proving tutorial IDs do not lock functionality.
3. Implement the shared effective-realm helper and use it in authorization paths.
4. Run targeted game-rules, content and queue tests.

### Task 2: Make combat a normal infinite idle action

**Files:**
- Modify: `config/releases/2026.08.16.1/actions.json`
- Modify: `apps/web/src/features/expedition/expedition-catalog.ts`
- Replace/simplify: `apps/web/src/features/expedition/expedition-page.tsx`
- Add/modify: expedition unit tests

1. Add failing catalog and page tests for map -> monster -> infinite queue behavior.
2. Add configured battle actions for the visible monsters with realm gates and deterministic drops.
3. Add action IDs to the monster catalog.
4. Implement direct monster-card start using the existing conflict-safe queue behavior.
5. Keep existing dungeon APIs available but remove them from the default combat page.

### Task 3: Remove duplicated durations and placeholder navigation

**Files:**
- Modify: `apps/web/src/features/dashboard/dashboard-adapter.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/navigation.ts`
- Modify: related tests

1. Add failing tests for configured action durations in global progress.
2. Feed the active action snapshot duration into the progress view instead of action-ID constants.
3. Make the first route the simple cultivation surface.
4. Keep only playable single-player pages and explicit network placeholders in the primary sidebar.

### Task 4: Complete local runtime and end-to-end validation

**Files:**
- Modify: `启动洞天.command`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/e2e/vertical-slice.spec.ts`

1. Start Worker from the local launcher with API and Web.
2. Run the real browser suite in CI when the test database service is available.
3. Replace stale E2E selectors with the simple user journey.
4. Verify desktop and mobile browser layouts and update the work log.
