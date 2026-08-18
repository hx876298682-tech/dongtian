# 洞府、修炼与历练职责重构 Implementation Plan

**Goal:** Align the three primary game areas with facility building, cultivation-style selection, and region/monster expedition selection.

### Task 1: Make 洞府 the facility-building destination

- [x] Point the main 洞府 navigation and root redirect to `/dashboard/cave`.
- [x] Move the existing queue workbench to `/dashboard/queue` and update global progress links.
- [x] Rename facility labels to 练功房、炼丹炉、锻造炉 while preserving backend IDs and mutations.
- [x] Add navigation and cave adapter tests.

### Task 2: Add cultivation-style selection

- [x] Add a cultivation catalog for 练气、练体、练剑、练刀.
- [x] Build `/cultivation` as a behavior selector using the shared queue starter.
- [x] Make only configured actions executable; show truthful unavailable states for missing paths.
- [x] Move the existing breakthrough UI to `/cultivation/breakthrough` and expose it as a child entry.
- [x] Add catalog, queue trigger, locked-state, and navigation tests.

### Task 3: Restructure expedition around regions and monsters

- [x] Add a region/monster catalog derived from the release region, monster, loot, and dungeon data.
- [x] Render region selection, monster cards, combat facts, drops, and enabled/disabled entry states.
- [x] Generalize the current expedition page from hardcoded 青蛇洞 constants to the selected supported dungeon/monster choice.
- [x] Preserve preview, enter, choose, finalize, active-run recovery, and truthful unsupported states.
- [x] Add adapter tests for mappings, drops, supported dungeon routes, and fallbacks.

### Task 4: Verify and record

- [x] Run focused tests, Web full tests, typecheck, lint, build, and `git diff --check`.
- [x] Update `docs/工作进度记录.md` with scope, data limitations, verification, and follow-up requirements.
