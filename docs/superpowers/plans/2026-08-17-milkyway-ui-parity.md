# Milky Way UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Dongtian's playable frontend with Milky Way Idle's full interaction grammar: fixed game shell, navigation hierarchy, persistent status surfaces, detail dialogs, and operation feedback, while preserving Dongtian's cultivation data and leaving deferred backend systems explicitly locked.

**Architecture:** Keep the existing React Router and API-backed page modules. Add reusable interaction primitives around `GameDialog`, shared feedback, and local UI state; page modules own only domain actions and query data. The shell remains fixed to one viewport, with internal scrolling only in the center workspace and bounded panels.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query, Radix Dialog, Vitest, existing CSS tokens.

---

### Task 1: Global game shell parity

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Write the failing tests** for a persistent current-action header, compact navigation groups, right-rail tab labels, bottom log channel switching, and dialog/toast feedback landmarks.
- [ ] **Step 2: Run the focused app test and verify it fails** because the expected Milky Way landmarks or state transitions are absent.
- [ ] **Step 3: Implement the minimal shell changes**: remove engineering-only labels from visible game surfaces, use dense game-panel spacing, expose all reference navigation groups, and keep current action/progress visible on every route.
- [ ] **Step 4: Run the focused test, typecheck, and lint** and fix only behavior or accessibility regressions.
- [ ] **Step 5: Commit** with `feat: align global idle game shell`.

### Task 2: Inventory and equipment operation parity

**Files:**
- Modify: `apps/web/src/features/inventory/inventory-page.tsx`
- Modify: `apps/web/src/features/character/equipment-page.tsx`
- Modify: `apps/web/src/components/game-dialog.tsx`
- Modify: `apps/web/src/styles.css`
- Test: existing inventory/equipment tests plus focused new tests beside each page

- [ ] **Step 1: Write failing tests** for clicking an inventory item to open its detail dialog, equipment selection to show comparison, and closing the dialog without losing the selected item.
- [ ] **Step 2: Run the focused tests and verify the expected failures.**
- [ ] **Step 3: Implement item detail, rarity/type presentation, equip/compare/temper entry actions, and real disabled states when API data cannot perform an operation.
- [ ] **Step 4: Run focused tests, web typecheck, and lint.**
- [ ] **Step 5: Commit** with `feat: add inventory and equipment detail flows`.

### Task 3: Task, queue, and maze operation parity

**Files:**
- Modify: `apps/web/src/features/dashboard/*`
- Modify: `apps/web/src/features/system/reference-pages.tsx`
- Modify: `apps/web/src/features/expedition/*`
- Modify: `apps/web/src/lib/game-feedback.ts`
- Test: dashboard, reference-page, and expedition focused tests

- [ ] **Step 1: Write failing tests** for task detail/reward state, start/pause/stop queue actions, maze room and automation dialogs, and settlement feedback.
- [ ] **Step 2: Run focused tests and verify they fail for missing interactions.**
- [ ] **Step 3: Implement dialogs and actions on top of existing queue, dungeon, and settlement APIs; keep unavailable backend flows locked and never fabricate rewards.
- [ ] **Step 4: Run focused tests, then the full web test/typecheck/lint/build matrix.**
- [ ] **Step 5: Commit** with `feat: complete idle task and maze interaction flows`.

### Final verification

- [ ] Run the route matrix at desktop and mobile viewport sizes and inspect screenshots for fixed one-screen layout, no page-level scroll, and no overlapping labels.
- [ ] Run `pnpm vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm openapi:check`, and `git diff --check`.
- [ ] Update `docs/工作进度记录.md` with exact evidence, remaining deferred systems, and any environment warnings.
- [ ] Request a final code review before claiming the parity milestone complete.

### Follow-up parity pass

- [ ] Replace right-rail link cards with compact live inventory/equipment/skill/cave summaries and preserve route actions.
- [ ] Expand reference pages with Milky Way-style tab content, locked-state dialogs, and player-facing empty states without inventing backend data.
- [ ] Apply the important-action confirmation setting to breakthrough, cave upgrade, tempering, and dungeon exit operations.
