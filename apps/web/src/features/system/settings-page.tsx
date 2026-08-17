import { useEffect, useState, type ReactElement } from 'react';

interface LocalGameSettings {
  readonly compactPanels: boolean;
  readonly reduceMotion: boolean;
  readonly showGameLog: boolean;
  readonly showTimestamps: boolean;
  readonly desktopNotifications: boolean;
  readonly confirmImportantActions: boolean;
}

const STORAGE_KEY = 'dongtian.game-settings.v1';
const DEFAULT_SETTINGS: LocalGameSettings = { compactPanels: true, reduceMotion: false, showGameLog: true, showTimestamps: true, desktopNotifications: false, confirmImportantActions: true };

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
  const [activeTab, setActiveTab] = useState<'个人资料' | '游戏' | '聊天' | '通知' | '账户'>('游戏');

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset['compactPanels'] = String(settings.compactPanels);
    document.documentElement.dataset['reduceMotion'] = String(settings.reduceMotion);
    document.documentElement.dataset['showGameLog'] = String(settings.showGameLog);
    document.documentElement.dataset['showTimestamps'] = String(settings.showTimestamps);
  }, [settings]);

  const toggle = (key: keyof LocalGameSettings): void => setSettings((current) => ({ ...current, [key]: !current[key] }));
  const toggleNotifications = async (): Promise<void> => {
    if (settings.desktopNotifications) {
      toggle('desktopNotifications');
      return;
    }
    if (!('Notification' in window)) return;
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') setSettings((current) => ({ ...current, desktopNotifications: true }));
  };

  return (
    <section className="settings-page">
      <header className="settings-page__header">
        <div><p className="page-card__eyebrow">设置</p><h3>游戏显示</h3></div>
        <p>这些选项保存在当前浏览器，不影响角色修行数据。</p>
      </header>
      <div className="settings-page__tabs" role="tablist" aria-label="设置分类">
        {(['个人资料', '游戏', '聊天', '通知', '账户'] as const).map((tab) => <button key={tab} className={activeTab === tab ? 'settings-page__tab settings-page__tab--active' : 'settings-page__tab'} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}
      </div>
      <div className="settings-page__list">
        {activeTab === '个人资料' ? <div className="settings-option"><span><strong>洞天散修</strong><small>当前使用匿名角色，修行进度保存在服务器角色记录中。</small></span><span className="settings-option__value">当前角色</span></div> : null}
        {activeTab === '游戏' ? <><label className="settings-option">
          <span><strong>紧凑游戏面板</strong><small>减少卡片间距，在一屏中展示更多任务和物品。</small></span>
          <input type="checkbox" checked={settings.compactPanels} onChange={() => toggle('compactPanels')} />
        </label>
        <label className="settings-option">
          <span><strong>减少界面动效</strong><small>关闭不必要的过渡动画，挂机进度仍会正常更新。</small></span>
          <input type="checkbox" checked={settings.reduceMotion} onChange={() => toggle('reduceMotion')} />
        </label></> : null}
        {activeTab === '聊天' ? <><label className="settings-option">
          <span><strong>显示修行日志</strong><small>在中央区域底部显示当前行动、最近收获和突破目标。</small></span>
          <input type="checkbox" checked={settings.showGameLog} onChange={() => toggle('showGameLog')} />
        </label><label className="settings-option"><span><strong>显示时间</strong><small>在日志消息前显示当前、最近和系统时间标签。</small></span><input type="checkbox" checked={settings.showTimestamps} onChange={() => toggle('showTimestamps')} /></label></> : null}
        {activeTab === '通知' ? <label className="settings-option"><span><strong>桌面通知</strong><small>挂机完成或秘境结算后允许浏览器发送通知。</small></span><input type="checkbox" checked={settings.desktopNotifications} onChange={() => void toggleNotifications()} /></label> : null}
        {activeTab === '账户' ? <label className="settings-option"><span><strong>重要操作确认</strong><small>突破、消耗保护材料和离开秘境前显示确认弹窗。</small></span><input type="checkbox" checked={settings.confirmImportantActions} onChange={() => toggle('confirmImportantActions')} /></label> : null}
      </div>
    </section>
  );
}
