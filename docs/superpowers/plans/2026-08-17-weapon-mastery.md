# 武器专精修炼 Implementation Plan

### Task 1: Extend release configuration and labels

- [x] Add sword, blade, spear, and staff mastery skills with a configurable per-level attack bonus.
- [x] Add one infinite 60-second mastery action per weapon type.
- [x] Update config schema/registry tests, content labels, and release manifest hash.

### Task 2: Add mastery cards to 修炼

- [x] Add a weapon mastery catalog/section below the existing cultivation directions.
- [x] Use the existing behavior queue starter and show real skill level, XP, duration, and unavailable states.
- [x] Add UI/adapter tests for filtering mastery actions and starting one.

### Task 3: Apply mastery to equipped weapons in combat

- [x] Match equipped weapon item tags to the corresponding mastery skill.
- [x] Apply the configured per-level attack multiplier to weapon attack when building dungeon combat context.
- [x] Add dungeon service/rules tests for matching, non-matching, and zero-level cases.

### Task 4: Verify and record

- [x] Run config validation, focused API/rules/Web tests, full tests, typecheck, lint, build, and `git diff --check`.
- [x] Update `docs/工作进度记录.md` with the balance assumption and verification results.
