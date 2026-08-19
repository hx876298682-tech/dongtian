import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

interface LocalGameSettings {
  readonly compactPanels: boolean;
  readonly reduceMotion: boolean;
  readonly showGameLog: boolean;
  readonly showTimestamps: boolean;
  readonly desktopNotifications: boolean;
  readonly confirmImportantActions: boolean;
}

type SettingsTab = '个人资料' | '游戏' | '聊天' | '通知' | '账户';

const SETTINGS_TABS = ['个人资料', '游戏', '聊天', '通知', '账户'] as const;
const SETTINGS_TITLES: Record<SettingsTab, string> = { 个人资料: '个人资料', 游戏: '游戏设置', 聊天: '聊天', 通知: '通知', 账户: '账户' };
const SETTINGS_COPIES: Record<SettingsTab, string> = {
  个人资料: '当前使用匿名角色，资料编辑功能暂未开放。',
  游戏: '调整洞天界面的显示、动效和操作确认方式。',
  聊天: '聊天与私信功能暂未开放，当前不会显示或保存聊天内容。',
  通知: '调整挂机完成和秘境结算的浏览器通知。',
  账户: '账号管理与资料同步暂未开放，当前不会创建或同步账号资料。',
};
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

function DeferredOption({ title, description }: { readonly title: string; readonly description: string }): ReactElement {
  return (
    <div className="settings-option settings-option--disabled" aria-disabled="true">
      <span><strong>{title}</strong><small>{description}</small></span>
      <button className="ghost-button ghost-button--compact settings-option__value" type="button" disabled={true}>暂未开放</button>
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const [settings, setSettings] = useState<LocalGameSettings>(readSettings);
  const [activeTab, setActiveTab] = useState<SettingsTab>('游戏');
  const settingsTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const currentIndex = SETTINGS_TABS.indexOf(activeTab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? SETTINGS_TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    const nextTab = SETTINGS_TABS[nextIndex];
    if (nextTab === undefined) return;
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => settingsTabRefs.current[nextIndex]?.focus());
  };

  return (
    <section className="settings-page" aria-label="设置总览">
      <header className="settings-page__header" aria-label="设置标题">
        <div><p className="page-card__eyebrow">设置</p><h3>{SETTINGS_TITLES[activeTab]}</h3></div>
        <p>{SETTINGS_COPIES[activeTab]}</p>
      </header>
      <div className="settings-page__tabs" role="tablist" aria-label="设置分类" onKeyDown={handleTabKeyDown}>
        {SETTINGS_TABS.map((tab, index) => <button key={tab} ref={(element) => { settingsTabRefs.current[index] = element; }} id={`settings-tab-${tab}`} className={activeTab === tab ? 'settings-page__tab settings-page__tab--active' : 'settings-page__tab'} type="button" role="tab" aria-selected={activeTab === tab} aria-controls="settings-panel" tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)}>{tab}</button>)}
      </div>
      <div className="settings-page__list" id="settings-panel" role="tabpanel" aria-label={`${SETTINGS_TITLES[activeTab]}选项`} aria-labelledby={`settings-tab-${activeTab}`}>
        {activeTab === '个人资料' ? <DeferredOption title="个人资料" description="当前使用匿名角色，资料编辑功能暂未开放。" /> : null}
        {activeTab === '游戏' ? <><label className="settings-option">
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
        <label className="settings-option"><span><strong>显示时间</strong><small>在日志消息前显示当前、最近和系统时间标签。</small></span><input type="checkbox" checked={settings.showTimestamps} onChange={() => toggle('showTimestamps')} /></label>
        <label className="settings-option"><span><strong>重要操作确认</strong><small>突破、消耗保护材料和结算秘境前显示确认弹窗。</small></span><input type="checkbox" checked={settings.confirmImportantActions} onChange={() => toggle('confirmImportantActions')} /></label></> : null}
        {activeTab === '聊天' ? <DeferredOption title="聊天功能" description="聊天与私信功能暂未开放，当前不会显示或保存聊天内容。" /> : null}
        {activeTab === '通知' ? <label className="settings-option"><span><strong>桌面通知</strong><small>挂机完成或秘境结算后允许浏览器发送通知。</small></span><input type="checkbox" checked={settings.desktopNotifications} onChange={() => void toggleNotifications()} /></label> : null}
        {activeTab === '账户' ? <DeferredOption title="账户管理" description="账号管理与资料同步暂未开放，当前不会创建或同步账号资料。" /> : null}
      </div>
    </section>
  );
}
