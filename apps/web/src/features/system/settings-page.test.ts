import { describe, expect, it } from 'vitest';

// The web package does not ship a DOM test renderer, so this contract test keeps
// the player-facing structure and source-backed local settings behavior explicit.
import settingsPageSource from './settings-page.tsx?raw';

describe('settings page reference parity', () => {
  it('keeps the five reference-style settings tabs in order', () => {
    expect(settingsPageSource).toMatch(/const SETTINGS_TABS = \['个人资料', '游戏', '聊天', '通知', '账户'\] as const/);
    expect(settingsPageSource).toMatch(/role="tablist" aria-label="设置分类"/);
    expect(settingsPageSource).toMatch(/role="tab"/);
    expect(settingsPageSource).toMatch(/tabIndex=\{activeTab === tab \? 0 : -1\}/);
    expect(settingsPageSource).toMatch(/onKeyDown=\{handleTabKeyDown\}/);
    expect(settingsPageSource).toMatch(/event\.key === 'Home'/);
    expect(settingsPageSource).toMatch(/event\.key === 'End'/);
    expect(settingsPageSource).toMatch(/settingsTabRefs\.current\[nextIndex\]\?\.focus\(\)/);
  });

  it('uses the active tab for the page title and preserves real local settings', () => {
    expect(settingsPageSource).toMatch(/<h3>\{SETTINGS_TITLES\[activeTab\]\}<\/h3>/);
    expect(settingsPageSource).toMatch(/window\.localStorage\.getItem\(STORAGE_KEY\)/);
    expect(settingsPageSource).toMatch(/window\.localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(settings\)\)/);
    for (const key of ['compactPanels', 'reduceMotion', 'showGameLog', 'showTimestamps', 'desktopNotifications', 'confirmImportantActions']) {
      expect(settingsPageSource).toContain(key);
    }
  });

  it('marks profile, chat, and account as deferred instead of fabricating persistence', () => {
    expect(settingsPageSource).toMatch(/settings-option--disabled/);
    expect(settingsPageSource).toMatch(/disabled=\{true\}/);
    expect(settingsPageSource).toMatch(/aria-disabled="true"/);
    expect(settingsPageSource).toMatch(/个人资料.*暂未开放|暂未开放.*个人资料/);
    expect(settingsPageSource).toMatch(/聊天.*暂未开放|暂未开放.*聊天/);
    expect(settingsPageSource).toMatch(/账户.*暂未开放|暂未开放.*账户/);
    expect(settingsPageSource).not.toMatch(/保存资料|发送消息|创建账号/);
  });

  it('keeps engineering terms out of visible player copy', () => {
    expect(settingsPageSource).not.toMatch(/<small>[^<]*(localStorage|API|后端|服务器角色记录|工程词)[^<]*<\/small>/);
    expect(settingsPageSource).not.toMatch(/<p>[^<]*(localStorage|API|后端|服务器角色记录|工程词)[^<]*<\/p>/);
  });
});
