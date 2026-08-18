# 百艺全行为执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the region-first behavior workflow from herbalism to mining, alchemy, and forging while preserving the existing queue and global progress contracts.

**Architecture:** Extract the queue mutation and action-card behavior into a shared behavior module. Gathering definitions reuse the six-region catalog; production definitions group actions by tags/skill and display inputs/outputs. Navigation stores child routes on the 百艺 route itself.

**Tech Stack:** React 19, React Router, TanStack Query, TypeScript, Vitest, existing contracts/api client.

### Task 1: Generalize behavior definitions and queue trigger

- [x] Define behavior categories for herbalism, mining, alchemy, and forging.
- [x] Extract shared action availability, queue start/retry/resume/invalidation, input/output labels, and feedback helpers.
- [x] Preserve herbalism behavior and tests while switching it to the shared implementation.

### Task 2: Add mining, alchemy, and forging pages

- [x] Add mining page using region selection and `ore` tagged actions.
- [x] Add alchemy page using recipe-group selection and `alchemy` tagged actions.
- [x] Add forging page using recipe-group selection and `forging` tagged actions.
- [x] Cover loading/error/empty/locked states and real queue-trigger helper tests.

### Task 3: Wire 百艺 child navigation and routes

- [x] Add children for mining, alchemy, and forging directly to the 百艺 route metadata.
- [x] Register `/craft/mining`, `/craft/alchemy`, and `/craft/forging` under the shell route.
- [x] Ensure skill-level navigation has no behavior child links and active child styling remains correct.

### Task 4: Verify and record

- [x] Run focused and full Web tests, typecheck, lint, build, and `git diff --check`.
- [x] Update `docs/工作进度记录.md` with implementation, validation, warnings, and follow-up reuse notes.
