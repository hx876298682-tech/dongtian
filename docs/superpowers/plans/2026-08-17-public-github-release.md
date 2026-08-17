# Public GitHub Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the current project, document its real development status, and publish the verified working tree to a new public GitHub repository.

**Architecture:** Treat the existing local `main` branch as the source of truth. Preserve all current feature work, add only release documentation, run repository-wide quality and security checks, then create and verify the GitHub remote.

**Tech Stack:** Git, GitHub CLI, pnpm 11, Node.js 24, TypeScript, Vitest, Playwright, ESLint, Prettier

---

### Task 1: Audit current development status

**Files:**

- Read: `README.md`
- Read: `docs/开发前文档包/10_开发拆解里程碑与垂直切片_V1.0.md`
- Read: application, package, tooling, and test inventories

- [x] **Step 1: Inspect commit history and the complete working-tree diff**

Run: `git status --short --branch && git log --oneline --decorate -12 && git diff --stat`

Expected: current branch, three existing milestones, and all pending feature files are visible.

- [x] **Step 2: Compare implemented modules and tests with milestone documentation**

Run: `find apps packages tooling tests -type f | sort`

Expected: enough evidence to distinguish implemented, partially verified, and future work.

### Task 2: Prepare documentation for a public repository

**Files:**

- Modify: `README.md`
- Create: `docs/工作进度记录.md`

- [x] **Step 1: Replace the obsolete foundation-only README status**

Document the playable vertical slice, main subsystems, repository layout, prerequisites, quality commands, and honest current limitations.

- [x] **Step 2: Create the persistent work-progress record required by AGENTS.md**

Record dated work details, current milestone status, verification evidence, known risks, and suggested next work so the document can support weekly reports.

### Task 3: Verify public-release readiness

**Files:**

- Read: `.gitignore`
- Read: all files selected for commit

- [x] **Step 1: Check for credentials and oversized files**

Run repository secret-pattern scans and inspect files larger than 5 MB while excluding generated dependencies and Git internals.

Expected: no credentials or inappropriate large artifacts selected for publication.

- [x] **Step 2: Run the full local quality gate**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Actual: Lint, typecheck, test, and build exited with code 0; format check remains blocked by 216 pre-existing / current files.

- [x] **Step 3: Run asset and OpenAPI consistency checks**

Run: `pnpm asset:validate && pnpm openapi:check`

Actual: OpenAPI is compatible; development asset validation passes with warnings, while release asset validation correctly blocks 22 placeholder entries.

### Task 4: Commit and publish

**Files:**

- Stage: all intended source, tests, assets, migrations, and release documentation

- [ ] **Step 1: Review staged contents and create one release-preparation commit**

Run: `git add -A && git diff --cached --check && git status --short && git commit -m "feat: add breakthrough flow and release readiness"`

Expected: one commit containing the existing pending feature set plus release documentation, with no ignored build outputs.

- [ ] **Step 2: Create the public GitHub repository and push `main`**

Run: `gh repo create dongtian --public --source=. --remote=origin --push --description "洞天：修仙 Idle MMO Web Monorepo"`

Expected: GitHub reports a public repository URL and `main` tracks `origin/main`.

- [ ] **Step 3: Verify the remote repository**

Run: `gh repo view --json nameWithOwner,url,visibility,defaultBranchRef && git status --short --branch && git ls-remote --heads origin main`

Expected: repository visibility is `PUBLIC`, default branch is `main`, remote HEAD matches local HEAD, and the working tree is clean.
