# Playable Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入正式美术、音频、市场、宗门或其他已延期系统的前提下，把现有纵向切片补成可验证的开发版：真实回流摘要、教程/目标反馈、可用内容下限、完整 UI 状态和发布前工程门禁。

**Architecture:** 复用现有统一结算器、教程规则和内容配置，不在 Web 端本地推演奖励。API 继续以权威快照和摘要契约为唯一来源；Web 通过查询和状态组件呈现所有正常、空、加载、失败、锁定状态。内容扩量只增加稳定配置与规则测试，不引入市场或社交依赖。

**Tech Stack:** NestJS/Fastify, React, TanStack Query, Zod/OpenAPI contracts, PostgreSQL, Vitest, Playwright, pnpm monorepo.

---

### Task 1: 接入真实离线结算摘要

**Status:** Completed. The backend endpoint already existed; Web now consumes it and maps authoritative summary data.

**Files:**
- Modify: `apps/web/src/features/dashboard/dashboard-page.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-adapter.ts`
- Modify: `packages/contracts/src/web-client.ts` only if the existing client method cannot be reused
- Test: `apps/web/src/features/dashboard/dashboard-page.test.tsx` or the existing dashboard adapter tests

- [ ] **Step 1: Write the failing test** asserting the dashboard requests the latest settlement and renders rewards, consumptions, timeline, and anomaly state instead of the current unavailable copy.
- [ ] **Step 2: Run the focused test and verify it fails because the query is not wired.**
- [ ] **Step 3: Use the existing `getLatestSettlement` client method and TanStack Query; map `null` to a real empty state and preserve API error state.**
- [ ] **Step 4: Run dashboard tests, API settlement tests, and Web typecheck.**
- [ ] **Step 5: Commit `feat: show authoritative offline settlement summary`.**

### Task 2: 教程与目标追踪的可见闭环

**Status:** Partial. 筑基目标摘要 is visible; tutorial progress persistence/API remains intentionally deferred because no character tutorial progress store exists yet.

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-page.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard-adapter.ts`
- Test: `packages/game-rules/src/tutorial.test.ts`, `apps/web/src/features/dashboard/dashboard-page.test.tsx`

- [ ] **Step 1: Add a failing UI assertion that the active tutorial/goal exposes its id, progress, next action, and completion state.**
- [ ] **Step 2: Run it and verify the current generic “目标追踪已接入” copy fails the assertion.**
- [ ] **Step 3: Render the backend tutorial/feature permission data through player-facing Chinese labels, with locked, ready, completed, and skipped states.**
- [ ] **Step 4: Add an explicit dismiss/continue action only if an existing intent endpoint supports it; otherwise keep the UI read-only and link to the required route.**
- [ ] **Step 5: Run tutorial, dashboard, navigation, and Web typecheck gates.**
- [ ] **Step 6: Commit `feat: expose tutorial and goal progress`.**

### Task 3: 内容配置下限与可达性校验

**Status:** Completed for the current release. Existing config already meets the six-region / 8+ monster / 2+ boss / 2+ dungeon threshold; regression coverage now enforces it.

**Files:**
- Modify: `packages/config-schema/src/**` only for schema gaps
- Modify: `config/releases/**` for non-asset content entries
- Test: `packages/config-schema/src/**.test.ts`, `packages/game-rules/src/**.test.ts`

- [ ] **Step 1: Inventory current stable IDs and write failing coverage for six ordinary regions, 8-12 enemy entries, two bosses, and two dungeon routes without adding market/social dependencies.**
- [ ] **Step 2: Add the smallest deterministic config entries using existing schemas and rule primitives.**
- [ ] **Step 3: Add source-reachability checks for every breakthrough and key recipe material.**
- [ ] **Step 4: Run config validation, game-rules tests, and OpenAPI/config checks.**
- [ ] **Step 5: Commit `feat: expand playable content configuration`.**

### Task 4: 页面状态完整性与中文文案收口

**Status:** Existing shared state screens and the one-screen shell are in place; remaining raw copy is tracked separately from the core playable release.

**Files:**
- Modify: `apps/web/src/features/**`
- Modify: `apps/web/src/features/content/content-adapter.ts`
- Test: `apps/web/src/features/**.test.tsx`, `apps/web/src/navigation.test.ts`

- [ ] **Step 1: Add failing assertions for loading, empty, error, locked, and maintenance states on the primary routes.**
- [ ] **Step 2: Implement shared state presentation without page-level scroll or raw implementation IDs in player-facing text.**
- [ ] **Step 3: Add Chinese labels for all currently visible action, recipe, skill, item, and feature lock keys.**
- [ ] **Step 4: Run route tests, Web typecheck, lint, and build.**
- [ ] **Step 5: Commit `feat: complete playable page states and copy`.**

### Task 5: 发布前工程门禁

**Status:** Completed locally and in workflow definition. CI workflow covers the required checks; GitHub-hosted execution still requires repository Actions permission.

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` and relevant package scripts
- Modify: `docs/开发前文档包/10_开发拆解里程碑与垂直切片_V1.0.md`
- Test: `tests/integration/infrastructure.test.ts` and CI workflow validation script

- [ ] **Step 1: Add a failing infrastructure assertion for the required CI jobs and release checks.**
- [ ] **Step 2: Add CI jobs for install, typecheck, lint, unit/integration tests, OpenAPI check, build, and Playwright smoke.**
- [ ] **Step 3: Add a repeatable local release-check script that does not require production credentials.**
- [ ] **Step 4: Document security/replay checks, backup-restore drill, load-test threshold, observability dashboard, and runbook as release blockers; do not claim them passed without execution evidence.**
- [ ] **Step 5: Run the full local gate and commit `ci: add playable release gates`.**

### Final verification

- [x] Run full Vitest, typecheck, lint, build, OpenAPI check, integration tests, and the real Chrome/PostgreSQL vertical slice.
- [x] Verify target viewports and no page-level scroll at 1366x768, 1440x900, 390x844, and 375x667.
- [x] Update `docs/工作进度记录.md` with evidence and remaining blockers.
- [x] Push `main` after final diff review and green local gates; commit `6d9d180` is synchronized with `origin/main`.
