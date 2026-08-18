# 百艺行为执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a region-first herbalism behavior page that starts the existing idle queue from a resource card and keeps progress visible in the global top bar.

**Architecture:** Keep the server as the authority for action unlocks and queue state. Add a small Web region catalog adapter, a focused HerbalismPage, and a navigation child link; trigger queue writes through the same single-action infinite plan used by the dashboard quick-start flow.

**Tech Stack:** React 19, React Router, TanStack Query, TypeScript, Vitest, existing `@dongtian/contracts` and `apiClient`.

---

### Task 1: Add region catalog adapter and tests

**Files:**
- Create: `apps/web/src/features/behavior/behavior-adapter.ts`
- Create: `apps/web/src/features/behavior/behavior-adapter.test.ts`

- [x] Define `HerbalismRegion` with id, label, description, stageLabel, actionIds, resourceItemIds, and `regionKind`.
- [x] Export the six configured region entries, preserving config order and only using existing action/resource ids.
- [x] Add helpers to find an action by region and to map known item ids to player-facing Chinese names.
- [x] Test ordering, region lookup, and fallback labels for unknown ids.

### Task 2: Build the herbalism page and behavior trigger

**Files:**
- Create: `apps/web/src/features/behavior/herbalism-page.tsx`
- Create: `apps/web/src/features/behavior/herbalism-page.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [x] Query progression, actions, and queue with TanStack Query.
- [x] Render loading, error, empty, region list, resource cards, and selected-region summary states.
- [x] Filter action catalog by selected region action ids; resolve output item names from action outputs.
- [x] On start, save a one-entry `INFINITE` queue using `createQueuePlanRequest` and an idempotency key, retry once on queue-version conflict, resume paused queues, invalidate global queue queries, and emit success/error feedback.
- [x] Register `/craft/herbalism` under the shell route.
- [x] Test page rendering and click behavior with mocked query/API data, including locked and unavailable actions.

### Task 3: Add the left navigation child entry and styling

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/navigation.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/navigation.test.ts`

- [x] Add an explicit “采集 / 采药” child link under the existing 百艺 skill section, active on `/craft/herbalism`.
- [x] Add a route glyph/metadata only where needed; keep `/craft` as the general 百艺 page.
- [x] Add compact game-panel styles for region buttons, resource cards, selected state, and action feedback, respecting the fixed single-viewport shell and internal scrolling rules.
- [x] Extend navigation coverage for the child path and active route.

### Task 4: Verify and update project work log

**Files:**
- Modify: `docs/工作进度记录.md`

- [x] Run focused behavior tests, Web typecheck, Web lint, full lint, and Web build.
- [x] Run `git diff --check`.
- [x] Record implementation details, verification results, environment caveats, and next-step reuse notes in the work log.
