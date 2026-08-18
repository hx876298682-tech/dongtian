# 全页面单屏布局 Implementation Plan

### Task 1: Establish shell and density tokens

- [x] Make the main content viewport-bound and remove page-level scrolling.
- [x] Add compact spacing/typography tokens and a shared dense panel/grid treatment.
- [x] Preserve mobile drawer behavior and accessibility focus states.

### Task 2: Reflow high-overflow pages

- [x] Reflow behavior pages, cultivation, and expedition into fixed two/three-column grids.
- [x] Reflow cave, dashboard queue, craft overview, inventory, and equipment pages into dense subgrids.
- [x] Keep dialogs as the only scrollable secondary surfaces.

### Task 3: Visual verification and regression coverage

- [x] Add layout-oriented tests for dense grid classes and no-scroll contracts where practical.
- [x] Use a 960×600 browser sweep to measure document and main-content scroll heights for all core routes.
- [x] Run full tests, typecheck, lint, build, and `git diff --check`.

### Task 4: Record and deliver

- [x] Update `docs/工作进度记录.md` with layout rules, measured routes, and verification results.
