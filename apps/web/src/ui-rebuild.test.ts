import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./ui-rebuild.css', import.meta.url), 'utf8');

describe('commercial UI layout safeguards', () => {
  it('keeps craft actions readable and touchable at both breakpoints', () => {
    expect(styles).toMatch(/\.content-workbench--craft[\s\S]*?\.content-list--compact[\s\S]*?grid-template-columns:\s*repeat\(3/);
    expect(styles).toMatch(/\.content-list--compact > \[role='tabpanel'\][\s\S]*?grid-auto-rows:\s*auto/);
    expect(styles).toMatch(/\.content-card--compact[\s\S]*?min-height:\s*204px/);
    expect(styles).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.content-card--compact[\s\S]*?min-height:\s*220px/);
    expect(styles).toMatch(/\.content-card--compact \.content-card__actions[\s\S]*?grid-row:\s*auto/);
    expect(styles).toMatch(/\.content-workbench--craft[\s\S]*?\.content-card__actions \.ghost-button[\s\S]*?min-height:\s*44px/);
  });

  it('allows settings and requirement copy to wrap or scroll instead of clipping', () => {
    expect(styles).toMatch(/\.settings-page__list[\s\S]*?overflow:\s*auto/);
    expect(styles).toMatch(/\.breakthrough-requirement p[\s\S]*?white-space:\s*normal/);
  });

  it('provides flexible fact rows and minimum touch targets for compact screens', () => {
    expect(styles).toMatch(/\.behavior-resource__facts[\s\S]*?grid-template-columns:\s*repeat\(2/);
    expect(styles).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.behavior-resource__facts[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(styles).toMatch(/\.behavior-layout--cultivation \.behavior-resource__facts[\s\S]*?height:\s*auto[\s\S]*?max-height:\s*none[\s\S]*?overflow:\s*visible/);
    expect(styles).toMatch(/\.equipment-panel button[\s\S]*?min-height:\s*44px/);
  });
});
