import { useEffect, useState, type ReactElement } from 'react';

interface LocalGameSettings {
  readonly compactPanels: boolean;
  readonly reduceMotion: boolean;
  readonly showGameLog: boolean;
}

const STORAGE_KEY = 'dongtian.game-settings.v1';
const DEFAULT_SETTINGS: LocalGameSettings = { compactPanels: true, reduceMotion: false, showGameLog: true };

function readSettings(): LocalGameSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...JSON.parse(stored) as Partial<LocalGameSettings> };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsPage(): ReactElement {
  const [settings, setSettings] = useState<LocalGameSettings>(readSettings);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset['compactPanels'] = String(settings.compactPanels);
    document.documentElement.dataset['reduceMotion'] = String(settings.reduceMotion);
    document.documentElement.dataset['showGameLog'] = String(settings.showGameLog);
  }, [settings]);

  const toggle = (key: keyof LocalGameSettings): void => setSettings((current) => ({ ...current, [key]: !current[key] }));

  return (
    <section className="settings-page">
      <header className="settings-page__header">
        <div><p className="page-card__eyebrow">设置</p><h3>游戏显示</h3></div>
        <p>这些选项保存在当前浏览器，不影响角色修行数据。</p>
      </header>
      <div className="settings-page__tabs" role="tablist" aria-label="设置分类">
        <button className="settings-page__tab settings-page__tab--active" type="button" role="tab" aria-selected="true">游戏</button>
        <button className="settings-page__tab" type="button" role="tab" aria-selected="false" disabled>通知</button>
        <button className="settings-page__tab" type="button" role="tab" aria-selected="false" disabled>账户</button>
      </div>
      <div className="settings-page__list">
        <label className="settings-option">
          <span><strong>紧凑游戏面板</strong><small>减少卡片间距，在一屏中展示更多任务和物品。</small></span>
          <input type="checkbox" checked={settings.compactPanels} onChange={() => toggle('compactPanels')} />
        </label>
        <label className="settings-option">
          <span><strong>减少界面动效</strong><small>关闭不必要的过渡动画，挂机进度仍会正常更新。</small></span>
          <input type="checkbox" checked={settings.reduceMotion} onChange={() => toggle('reduceMotion')} />
        </label>
        <label className="settings-option">
          <span><strong>显示修行日志</strong><small>在中央区域底部显示当前行动、最近收获和突破目标。</small></span>
          <input type="checkbox" checked={settings.showGameLog} onChange={() => toggle('showGameLog')} />
        </label>
      </div>
    </section>
  );
}
