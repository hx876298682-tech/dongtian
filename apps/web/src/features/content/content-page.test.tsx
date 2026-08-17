import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { clearContentDetailSearch, describeInventoryCategory } from './content-page.js';

describe('content detail overlays', () => {
  it('clears the selected detail query while preserving unrelated content state', () => {
    expect(clearContentDetailSearch('?tab=recipes&recipe_id=recipe.t1.qi_gathering_pill&ref=inventory', 'recipe_id')).toBe('?tab=recipes&ref=inventory');
    expect(clearContentDetailSearch('?item_id=item.t1.qingling_herb&filter=materials', 'item_id')).toBe('?filter=materials');
  });

  it('uses an overlay detail surface instead of a fixed third panel', () => {
    const source = readFileSync(new URL('./content-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { GameDialog } from '../../components/game-dialog.js';");
    expect(source).toContain('<GameDialog');
    expect(source).toContain('clearContentDetailSearch');
    expect(source).toContain('content-screen--single');
    expect(source).toContain('inventory-screen');
    expect(source).not.toMatch(/<div className="content-panel">\s*\{activeTab === 'actions'/s);
    expect(source).not.toMatch(/<div className="content-panel">\s*\{selectedItem \?/s);
  });

  it('keeps craft and inventory as compact workbenches without repeated hero metrics', () => {
    const source = readFileSync(new URL('./content-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('content-workbench');
    expect(source).toContain('content-workbench__header');
    expect(source).toContain('content-card--compact');
    expect(source).toContain('content-detail__summary');
    expect(source).not.toContain('dashboard-metrics');
    expect(source).not.toContain('content-hero__skills');
    expect(source).not.toContain('content-panel--hero');
    expect(source).not.toContain('<NormalStateScreen');
  });

  it('maps inventory categories into player-facing labels', () => {
    expect(describeInventoryCategory('HERB')).toBe('灵草');
    expect(describeInventoryCategory('ORE')).toBe('矿材');
    expect(describeInventoryCategory('MATERIAL')).toBe('炼丹 / 炼器材料');
  });

  it('derives the active content tab from a detail deep link and handles unknown details', () => {
    const source = readFileSync(new URL('./content-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('selectedRecipeId !== null');
    expect(source).toContain('未找到对应的行动');
    expect(source).toContain('未找到对应的配方');
    expect(source).toContain('未找到对应的修行物品');
  });

  it('moves focus when switching content tabs with arrow keys', () => {
    const source = readFileSync(new URL('./content-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('contentTabRefs');
    expect(source).toContain('contentTabRefs.current[nextTab]?.focus()');
    expect(source).toContain("event.key === 'Home'");
    expect(source).toContain("event.key === 'End'");
  });
});
