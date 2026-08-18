import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import type { AuthActiveSession, DungeonOpportunityResponse, Queue, QueueEntry } from '@dongtian/contracts';
import { apiClient } from '../../lib/api.js';
import { GameDialog } from '../../components/game-dialog.js';
import { buildIdleProgressView, describeAction, describeItem } from '../dashboard/dashboard-adapter.js';

type ReferencePageKind = 'tasks' | 'maze' | 'shops' | 'store' | 'cowbell-shop' | 'achievements' | 'leaderboard' | 'guild' | 'social' | 'guide' | 'rules' | 'news' | 'changelog';
type ReferenceItem = { readonly title: string; readonly copy: string; readonly state?: string; readonly href?: string };
interface ReferencePageConfig { readonly kind: ReferencePageKind; readonly title: string; readonly eyebrow: string; readonly copy: string; readonly tabs: readonly string[]; readonly panelTitle: string; readonly panelCopy: string; readonly locked?: string; readonly hideTabs?: boolean }

const CONFIG: Record<ReferencePageKind, ReferencePageConfig> = {
  tasks: { kind: 'tasks', title: '修行任务', eyebrow: '任务', copy: '当前队列与任务操作。', tabs: ['任务栏', '任务商店'], panelTitle: '任务栏', panelCopy: '队列中的任务、目标、进度和结算状态。' },
  maze: { kind: 'maze', title: '秘境迷宫', eyebrow: '迷宫', copy: '青蛇洞入口与运行状态。', tabs: ['迷宫', '房间', '自动化', '迷宫商店'], panelTitle: '青蛇洞', panelCopy: '查看真实探险机会，并从这里进入房间和自动化入口。' },
  shops: { kind: 'shops', title: '洞天市场', eyebrow: '市场', copy: '查看公开挂牌和资源流通入口。', tabs: ['商品列表', '我的挂牌'], panelTitle: '市场订单簿', panelCopy: '市场交易暂未开放，当前保留页面层级。', locked: '市场交易暂未开放，开放后接入真实挂牌、价格和购买操作。' },
  store: { kind: 'store', title: '洞天商店', eyebrow: '商店', copy: '兑换修行资源和秘境补给。', tabs: ['杂货', '地下城'], panelTitle: '坊市货架', panelCopy: '按分类浏览可兑换的修行资源。', locked: '商店暂未开放，开放后接入真实商品、价格和购买操作。' },
  'cowbell-shop': { kind: 'cowbell-shop', title: '牛铃商店', eyebrow: '牛铃商店', copy: '查看特殊补给和外观兑换入口。', tabs: ['购买牛铃', '哞卡', '便利升级', '聊天图标', '名称颜色', '角色形象', '角色服装', '角色背景', '角色边框', '社区增益', '更改名称'], panelTitle: '特殊兑换', panelCopy: '特殊兑换暂未开放，当前不显示虚构价格或商品。', locked: '牛铃商店暂未开放，开放后接入真实商品和兑换操作。' },
  achievements: { kind: 'achievements', title: '修行成就', eyebrow: '成就', copy: '记录你在修炼、炼丹、秘境和突破路上的里程碑。', tabs: ['成就', '收藏', '妖兽图鉴'], panelTitle: '里程碑记录', panelCopy: '按修行方向查看已经记录的成就。', locked: '成就、收藏和妖兽图鉴暂未开放，当前不虚构完成状态。' },
  leaderboard: { kind: 'leaderboard', title: '修行榜', eyebrow: '排行榜', copy: '按模式和统计类别查看成长记录。', tabs: ['标准', '铁牛', '公会'], panelTitle: '修行排行', panelCopy: '先选择模式，再选择统计类别。', locked: '排行榜暂未开放，当前不显示假排名。' },
  guild: { kind: 'guild', title: '宗门', eyebrow: '宗门', copy: '加入宗门，与其他修士共同修行。', tabs: ['宗门'], panelTitle: '宗门面板', panelCopy: '查看宗门、成员与公告状态。', locked: '宗门功能暂未开放，开放后接入真实成员和权限。', hideTabs: true },
  social: { kind: 'social', title: '仙友', eyebrow: '社交', copy: '管理仙友、私信和组队关系。', tabs: ['仙友', '推荐', '屏蔽'], panelTitle: '仙友列表', panelCopy: '查看仙友关系和消息入口。', locked: '仙友功能暂未开放，当前不伪造玩家和消息。' },
  guide: { kind: 'guide', title: '修行指南', eyebrow: '指南', copy: '从第一次挂机到筑基突破，逐步了解洞天里的修行方式。', tabs: ['常见问题', '采集类专业', '生产类专业', '炼金', '强化', '战斗', '任务', '迷宫', '交易市场', '公会', '成就', '聊天命令', '经验表'], panelTitle: '指南条目', panelCopy: '按修行主题阅读已开放的说明。' },
  rules: { kind: 'rules', title: '修行规则', eyebrow: '规则', copy: '查看挂机、结算、突破和秘境的基础规则。', tabs: ['规则'], panelTitle: '规则条目', panelCopy: '查看当前生效的规则说明。', hideTabs: true },
  news: { kind: 'news', title: '洞天新闻', eyebrow: '新闻', copy: '查看洞天近期开放的玩法和规则变化。', tabs: ['新闻'], panelTitle: '新闻', panelCopy: '查看已上线的洞天内容。', hideTabs: true },
  changelog: { kind: 'changelog', title: '更新日志', eyebrow: '更新日志', copy: '查看洞天版本更新记录。', tabs: ['更新日志'], panelTitle: '更新记录', panelCopy: '按版本查看已上线与规划中的系统记录。', hideTabs: true },
};

const guideSections: Record<string, readonly ReferenceItem[]> = {
  常见问题: [{ title: '第一次挂机', copy: '进入洞府后选择任务，点击任务卡即可开始。' }, { title: '离线收获', copy: '回来后查看结算摘要，确认修为和物品到账。' }],
  采集类专业: [{ title: '采集行动', copy: '在百艺页选择已开放的采集行动，行动完成后材料会回到背包。', href: '/craft' }],
  生产类专业: [{ title: '材料生产', copy: '生产页会按已开放配方和库存显示可执行内容。', href: '/craft' }],
  炼金: [{ title: '炼丹', copy: '炼丹配方和材料准备完成后，可在百艺页开始生产。', href: '/craft' }],
  强化: [{ title: '装备强化', copy: '角色页展示已获得装备，开放强化操作后会在这里说明。', href: '/character' }],
  战斗: [],
  任务: [{ title: '修行任务', copy: '任务栏显示当前队列、目标进度和结算状态。', href: '/tasks' }],
  迷宫: [{ title: '秘境探险', copy: '迷宫页展示真实探险机会，房间和自动化入口会跳转到历练页。', href: '/maze' }],
  交易市场: [],
  公会: [],
  成就: [],
  聊天命令: [],
  经验表: [{ title: '修为与境界', copy: '修炼页展示当前修为、境界门槛和可用突破操作。', href: '/cultivation' }],
};
const ruleSections: Record<string, readonly ReferenceItem[]> = { 规则: [{ title: '挂机结算', copy: '队列按照任务顺序执行，材料不足时按策略处理。' }, { title: '资源变化', copy: '每轮任务完成后记录修为、灵石和物品变化。' }, { title: '突破条件', copy: '达到境界门槛并满足材料条件后才可突破。' }, { title: '探险结算', copy: '战斗与路线完成后，系统按真实结果发放收获。' }] };
const newsSections: Record<string, readonly ReferenceItem[]> = { 新闻: [{ title: '当前进展', copy: '洞天已开放挂机、修炼、生产、装备、背包和秘境流程。', state: '已上线' }] };
const changelogSections: Record<string, readonly ReferenceItem[]> = { 更新日志: [{ title: '银河奶牛式页面对齐', copy: '本轮补齐任务、迷宫、商店页面族和移动端可达入口。', state: '已上线' }, { title: '未开放内容边界', copy: '市场、牛铃商店、宗门、社交和排行保持明确锁定，不伪造交易或玩家数据。', state: '记录' }] };
const statusLabel: Record<string, string> = { RUNNING: '进行中', QUEUED: '待执行', DONE: '已完成', DONE_INCOMPLETE: '已完成', DONE_CONDITION_MET: '已完成', BLOCKED: '已阻塞', CANCELLED: '已取消' };
const completedTaskStatuses = new Set<QueueEntry['status']>(['DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET']);

function queueEntriesWithCurrent(queue: Queue): readonly QueueEntry[] {
  if (queue.current === null || queue.entries.some((entry) => entry.entry_id === queue.current?.entry_id)) return queue.entries;
  return [queue.current, ...queue.entries];
}

export function selectTaskItemsByTab(queue: Queue, activeTab: string): readonly QueueEntry[] {
  const entries = queueEntriesWithCurrent(queue);
  if (activeTab === '任务栏') return entries;
  if (activeTab === '当前任务') return entries.filter((entry) => entry.entry_id === queue.current?.entry_id || entry.status === 'RUNNING' || entry.status === 'QUEUED');
  if (activeTab === '已完成') return entries.filter((entry) => completedTaskStatuses.has(entry.status));
  if (activeTab === '目标') return entries.filter((entry) => entry.target_value !== null || entry.condition_item_id !== null);
  return [];
}

function ItemList({ items, emptyCopy = '暂无可展示记录', onItemDetail, actionLabel = '前往操作' }: { readonly items: readonly ReferenceItem[]; readonly emptyCopy?: string; readonly onItemDetail: (item: ReferenceItem) => void; readonly actionLabel?: string }): ReactElement {
  const [filter, setFilter] = useState('全部');
  const filtered = filter === '全部' ? items : items.filter((item) => item.state === filter);
  return <div className="reference-list-panel"><div className="reference-list-panel__filters" aria-label="筛选"><span>筛选</span>{['全部', '进行中', '已完成'].map((value) => <button key={value} className={filter === value ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>{filtered.length === 0 ? <div className="reference-empty-state"><strong>{emptyCopy}</strong><p>当前分类没有可用数据，系统不会用示例记录代替真实结果。</p></div> : <div className="reference-guide-list">{filtered.map((item) => <article key={item.title} className="reference-guide-card"><span className="reference-task-card__state">{item.state ?? '参考说明'}</span><h4>{item.title}</h4><p>{item.copy}</p><button className="ghost-button" type="button" onClick={() => onItemDetail(item)}>查看详情</button>{item.href ? <Link className="ghost-button" to={item.href}>{actionLabel}</Link> : null}</article>)}</div>}</div>;
}

function ContentPanel({ config, activeTab, items, onItemDetail }: { readonly config: ReferencePageConfig; readonly activeTab: string; readonly items: readonly ReferenceItem[]; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const eyebrow = config.hideTabs ? config.eyebrow : `${config.eyebrow} · ${activeTab}`;
  return <section className={`reference-content-panel reference-content-panel--${config.kind}`} aria-label={`${config.title}${activeTab}`}><header className="reference-content-panel__header"><span className="reference-task-card__state">{eyebrow}</span><h4>{config.panelTitle}</h4><p>{config.panelCopy}</p></header>{items.length === 0 ? <div className="reference-empty-state"><strong>暂无已记录内容</strong><p>当前分类没有可用数据，系统不会用示例记录代替真实结果。</p></div> : <ol className="reference-content-list">{items.map((item, index) => <li key={item.title} className="reference-content-row"><span className="reference-content-row__index">{String(index + 1).padStart(2, '0')}</span><div><span className="reference-task-card__state">{item.state ?? '参考说明'}</span><h5>{item.title}</h5><p>{item.copy}</p></div><button className="ghost-button" type="button" onClick={() => onItemDetail(item)}>查看详情</button></li>)}</ol>}</section>;
}

function describeTaskTarget(entry: QueueEntry): string | null {
  if (entry.target_value === null || entry.target_value === '') return null;
  if (entry.mode === 'DURATION') return `持续 ${entry.target_value} 秒`;
  if (entry.mode === 'COUNT') return `目标 ${entry.target_value} 次`;
  if (entry.mode === 'UNTIL_INVENTORY' && entry.condition_item_id !== null) return `库存 ${describeItem(entry.condition_item_id)} ${entry.condition_operator ?? '达到'} ${entry.target_value}`;
  return `目标 ${entry.target_value}`;
}

function queueEntryToItem(entry: QueueEntry, title = describeAction(entry.action_id), href = '/dashboard/queue'): ReferenceItem {
  const target = describeTaskTarget(entry);
  return { title, copy: `${target === null ? '' : `${target}，`}已完成 ${entry.completed_cycles} 轮。`, state: statusLabel[entry.status] ?? '待执行', href };
}

export interface TaskRowView {
  readonly entryId: string;
  readonly title: string;
  readonly status: string;
  readonly statusCode: QueueEntry['status'];
  readonly targetLabel: string;
  readonly progress: number | null;
  readonly progressLabel: string;
  readonly rewardLabel: string;
  readonly href: string;
}

function countProgress(entry: QueueEntry): { readonly progress: number; readonly label: string } | null {
  if (entry.mode !== 'COUNT' || entry.target_value === null || entry.target_value === '') return null;
  const target = Number(entry.target_value);
  const completed = Number(entry.completed_cycles);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(completed)) return null;
  return { progress: Math.min(1, Math.max(0, completed / target)), label: `${entry.completed_cycles} / ${entry.target_value} 轮` };
}

function formatTaskDuration(microseconds: number): string {
  const seconds = Math.max(0, Math.round(microseconds / 1_000_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainder} 秒`;
}

function durationProgress(entry: QueueEntry, queue: Queue, nowMs: number): { readonly progress: number; readonly label: string } | null {
  if (entry.mode !== 'DURATION' || entry.target_value === null || entry.target_value === '') return null;
  const targetSeconds = Number(entry.target_value);
  const completedCycles = Number(entry.completed_cycles);
  const progressTimeUs = Number(entry.progress_time_us);
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0 || !Number.isFinite(completedCycles) || !Number.isFinite(progressTimeUs)) return null;
  if (completedTaskStatuses.has(entry.status)) return { progress: 1, label: '已完成' };
  const cycleUs = Number(entry.base_duration_us ?? '60000000');
  let partialUs = progressTimeUs;
  if (queue.current?.entry_id === entry.entry_id && entry.status === 'RUNNING' && !queue.paused) {
    const asOfMs = Date.parse(queue.as_of);
    if (Number.isFinite(asOfMs)) partialUs += Math.max(0, nowMs - asOfMs) * 1_000;
  }
  const elapsedUs = Math.max(0, completedCycles * cycleUs + partialUs);
  const targetUs = targetSeconds * 1_000_000;
  return {
    progress: Math.min(1, elapsedUs / targetUs),
    label: `${formatTaskDuration(elapsedUs)} / ${formatTaskDuration(targetUs)}`,
  };
}

function describeTaskRewardState(status: QueueEntry['status']): string {
  if (completedTaskStatuses.has(status)) return '已结算';
  if (status === 'BLOCKED' || status === 'CANCELLED') return '未结算';
  return '待结算';
}

export function buildTaskRow(entry: QueueEntry, queue: Queue, nowMs = Date.now()): TaskRowView {
  const currentView = queue.current?.entry_id === entry.entry_id ? buildIdleProgressView(queue, nowMs) : null;
  const count = countProgress(entry);
  const duration = durationProgress(entry, queue, nowMs);
  const targetProgress = count ?? duration;
  const actionProgress = currentView === null || (entry.mode !== 'INFINITE' && entry.mode !== 'UNTIL_INVENTORY')
    ? null
    : { progress: currentView.progress, label: `${Math.round(currentView.progress * 100)}% · ${currentView.remaining}` };
  const progress = targetProgress?.progress ?? actionProgress?.progress ?? (completedTaskStatuses.has(entry.status) ? 1 : entry.status === 'QUEUED' ? 0 : null);
  const progressLabel = targetProgress?.label ?? actionProgress?.label ?? (completedTaskStatuses.has(entry.status) ? '已完成' : entry.status === 'QUEUED' ? '等待执行' : '进度不可用');
  return {
    entryId: entry.entry_id,
    title: describeAction(entry.action_id),
    status: statusLabel[entry.status] ?? '待执行',
    statusCode: entry.status,
    targetLabel: describeTaskTarget(entry) ?? '持续执行',
    progress,
    progressLabel,
    rewardLabel: describeTaskRewardState(entry.status),
    href: entry.entry_id === queue.current?.entry_id ? '/dashboard/queue' : '/dashboard/queue',
  };
}

export function buildTaskRows(queue: Queue, activeTab: string, nowMs = Date.now()): readonly TaskRowView[] {
  return selectTaskItemsByTab(queue, activeTab).map((entry) => buildTaskRow(entry, queue, nowMs));
}

function taskRowToItem(entry: QueueEntry, row: TaskRowView): ReferenceItem {
  const item = queueEntryToItem(entry, row.title, row.href);
  return { ...item, copy: `${row.targetLabel} · ${row.progressLabel} · 奖励${row.rewardLabel}` };
}

function TaskRows({ queue, activeTab, onItemDetail }: { readonly queue: Queue; readonly activeTab: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const rows = buildTaskRows(queue, activeTab);
  if (rows.length === 0) return <div className="reference-empty-state"><strong>还没有安排修行任务</strong><p>当前队列没有可展示记录，系统不会用示例任务代替真实结果。</p></div>;
  const entries = queueEntriesWithCurrent(queue);
  return <ol className="reference-task-list">{rows.map((row) => {
    const entry = entries.find((candidate) => candidate.entry_id === row.entryId);
    if (entry === undefined) return null;
    return <li key={row.entryId} className={row.statusCode === 'RUNNING' ? 'reference-task-row reference-task-row--active' : 'reference-task-row'}><div className="reference-task-row__main"><span className="reference-task-card__state">{row.status}</span><h4>{row.title}</h4><p>{row.targetLabel}</p></div><div className="reference-task-row__progress"><progress max={1} value={row.progress ?? undefined} aria-label={`${row.title}进度`} /><span>{row.progressLabel}</span></div><div className="reference-task-row__reward"><span>奖励</span><strong>{row.rewardLabel}</strong></div><div className="reference-task-row__actions"><button className="ghost-button" type="button" onClick={() => onItemDetail(taskRowToItem(entry, row))}>详情</button><Link className="ghost-button" to={row.href}>前往</Link></div></li>;
  })}</ol>;
}

function ReferenceQueryError({ copy, onRetry }: { readonly copy: string; readonly onRetry: () => void }): ReactElement {
  return <div className="reference-query-error" role="alert"><strong>{copy}</strong><p>请检查网络连接，稍后再试。</p><button className="ghost-button" type="button" onClick={onRetry}>重试</button></div>;
}

function TasksPanel({ characterId, activeTab, onItemDetail }: { readonly characterId: string; readonly activeTab: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const queueQuery = useQuery<Queue>({ queryKey: ['reference-tasks', characterId], queryFn: () => apiClient.getQueue(characterId), staleTime: 1_000, refetchInterval: 1_000 });
  if (queueQuery.data === undefined && queueQuery.isError) return <ReferenceQueryError copy="任务队列暂时无法读取" onRetry={() => void queueQuery.refetch()} />;
  if (queueQuery.data === undefined) return <div className="reference-empty-state"><strong>正在读取任务队列</strong><p>任务状态以当前进度为准。</p></div>;
  return <>{queueQuery.isError ? <ReferenceQueryError copy="任务队列更新失败，当前显示上一次记录" onRetry={() => void queueQuery.refetch()} /> : null}<TaskRows queue={queueQuery.data} activeTab={activeTab} onItemDetail={onItemDetail} /></>;
}

function MazePanel({ characterId, activeTab, onItemDetail }: { readonly characterId: string; readonly activeTab: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const opportunityQuery = useQuery<DungeonOpportunityResponse>({ queryKey: ['reference-maze', characterId], queryFn: () => apiClient.getDungeonOpportunities(characterId), staleTime: 10_000 });
  if (opportunityQuery.data === undefined && opportunityQuery.isError) return <ReferenceQueryError copy="秘境机会暂时无法读取" onRetry={() => void opportunityQuery.refetch()} />;
  if (opportunityQuery.data === undefined) return <div className="reference-empty-state"><strong>正在读取秘境状态</strong><p>秘境机会以当前记录为准。</p></div>;
  const current = opportunityQuery.data?.opportunity.current_opportunities ?? 0;
  const cap = opportunityQuery.data?.opportunity.opportunity_cap ?? 0;
  const roomEntry: ReferenceItem = { title: '秘境房间', copy: '前往秘境页查看真实房间和路线状态。', state: '前往秘境', href: '/expedition' };
  const automationEntry: ReferenceItem = { title: '自动化探险', copy: '前往秘境页查看当前可用的探险策略。', state: '前往秘境', href: '/expedition' };
  const dungeonEntry: ReferenceItem = { title: '青蛇洞', copy: `今日可用探险机会 ${current}/${cap}。`, state: current > 0 ? '可进入' : '机会用尽', href: '/expedition' };
  const items: readonly ReferenceItem[] = activeTab === '房间' ? [roomEntry] : activeTab === '自动化' ? [automationEntry] : [dungeonEntry, roomEntry, automationEntry];
  return <>{opportunityQuery.isError ? <ReferenceQueryError copy="秘境状态更新失败，当前显示上一次记录" onRetry={() => void opportunityQuery.refetch()} /> : null}<div className="reference-maze-panel"><header className="reference-maze-panel__header"><span className="reference-task-card__state">迷宫 · {activeTab}</span><h4>{CONFIG.maze.panelTitle}</h4><p>{CONFIG.maze.panelCopy}</p></header><ItemList items={items} emptyCopy="暂无可查看的迷宫记录" onItemDetail={onItemDetail} actionLabel="打开秘境" /></div></>;
}

function LockedHeader({ config, activeTab }: { readonly config: ReferencePageConfig; readonly activeTab: string }): ReactElement {
  return <header className="reference-locked-panel__header"><span className="reference-task-card__state">{config.eyebrow} · {activeTab}</span><h4>{config.panelTitle}</h4><p>{config.panelCopy}</p></header>;
}

const personalLeaderboardCategories = ['总等级', '采集', '生产', '战斗', '任务积分', '迷宫积分', '收藏积分', '妖兽图鉴'] as const;
const guildLeaderboardCategories = ['等级', '建筑', '圣坛', '公会积分', '每周积分', '每周试炼'] as const;

function LeaderboardLockedPanel({ config, activeTab }: { readonly config: ReferencePageConfig; readonly activeTab: string }): ReactElement {
  const categories = activeTab === '公会' ? guildLeaderboardCategories : personalLeaderboardCategories;
  const [category, setCategory] = useState<string>(categories[0]);
  const categoryIndex = Math.max(0, categories.indexOf(category as never));
  const categoryRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedCategory = categories.includes(category as never) ? category : categories[0];
  const handleCategoryKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? categories.length - 1
        : (categoryIndex + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
    const nextCategory = categories[nextIndex];
    if (nextCategory === undefined) return;
    setCategory(nextCategory);
    window.requestAnimationFrame(() => categoryRefs.current[nextIndex]?.focus());
  };
  return <section className="reference-locked-panel reference-leaderboard-lock" aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><div className="reference-leaderboard-lock__mode"><span>游戏模式</span><strong>{activeTab}</strong></div><div className="reference-leaderboard-lock__categories" role="tablist" aria-label={`${activeTab}统计类别`} onKeyDown={handleCategoryKeyDown}>{categories.map((candidate, index) => <button key={candidate} ref={(element) => { categoryRefs.current[index] = element; }} id={`leaderboard-category-tab-${index}`} className={candidate === selectedCategory ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" role="tab" aria-selected={candidate === selectedCategory} aria-controls={`leaderboard-category-panel-${index}`} tabIndex={candidate === selectedCategory ? 0 : -1} onClick={() => setCategory(candidate)}>{candidate}</button>)}</div><div className="reference-leaderboard-lock__category-panel" id={`leaderboard-category-panel-${categoryIndex}`} role="tabpanel" aria-labelledby={`leaderboard-category-tab-${categoryIndex}`} tabIndex={0}><span>统计类别</span><strong>{selectedCategory}</strong><small>排行榜开放后会显示排名、数值与个人名次。</small></div><div className="reference-leaderboard-lock__empty"><strong>暂无真实排行数据</strong><span>当前不会用示例排名代替真实结果。</span></div><p>{config.locked}</p><button className="ghost-button" type="button" disabled>等待排行榜开放</button></section>;
}

function LockedPanel({ config, activeTab, copy }: { readonly config: ReferencePageConfig; readonly activeTab: string; readonly copy?: string }): ReactElement {
  const message = copy ?? config.locked ?? '当前系统尚未开放。';
  if (config.kind === 'shops' || config.kind === 'store' || config.kind === 'cowbell-shop') {
    const shelves = config.kind === 'cowbell-shop'
      ? ['外观与身份', '便利升级', '社区增益']
      : activeTab === '地下城'
        ? ['秘境补给', '探险消耗', '地下城兑换']
        : ['灵石兑换', '修行材料', '日常补给'];
    return <section className="reference-locked-panel reference-shop-lock" aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><div className="reference-shop-lock__shelves" aria-label="货架分类">{shelves.map((shelf) => <span key={shelf}>{shelf}</span>)}</div><p>{message}</p><p>商品、价格和购买操作开放后会显示在这里。</p><button className="ghost-button" type="button" disabled>等待商店开放</button></section>;
  }
  if (config.kind === 'achievements') {
    return <section className="reference-locked-panel reference-achievement-lock" aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><div className="reference-achievement-lock__summary"><strong>尚无成就记录</strong><span>成就数据服务尚未开放</span></div><p>{message}</p><button className="ghost-button" type="button" disabled>等待成就开放</button></section>;
  }
  if (config.kind === 'leaderboard') {
    return <LeaderboardLockedPanel config={config} activeTab={activeTab} />;
  }
  if (config.kind === 'guild') {
    return <section className="reference-locked-panel reference-guild-lock" aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><dl className="reference-guild-lock__facts"><div><dt>宗门状态</dt><dd>暂未开放</dd></div><div><dt>成员数据</dt><dd>暂不可查看</dd></div><div><dt>公告</dt><dd>暂不可查看</dd></div></dl><p>{message}</p><button className="ghost-button" type="button" disabled>等待宗门开放</button></section>;
  }
  if (config.kind === 'social') {
    return <section className="reference-locked-panel reference-social-lock" aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><div className="reference-social-lock__state"><span>仙友关系</span><strong>社交服务未开放</strong><p>当前没有真实仙友、私信或组队记录。</p></div><p>{message}</p><button className="ghost-button" type="button" disabled>等待社交开放</button></section>;
  }
  return <section className={`reference-locked-panel reference-locked-panel--${config.kind}`} aria-label={`${config.title}${activeTab}状态`}><LockedHeader config={config} activeTab={activeTab} /><div className="reference-locked-panel__status"><span>开放状态</span><strong>系统锁定</strong></div><p>{message}</p><p>当前没有真实记录可展示，暂不伪造商品、排名、成员或消息。</p><button className="ghost-button" type="button" disabled>等待系统开放</button></section>;
}

export function ReferencePage({ kind }: { readonly kind: ReferencePageKind }): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const config = CONFIG[kind];
  const [activeTab, setActiveTab] = useState(config.tabs[0] ?? '总览');
  const [detail, setDetail] = useState<ReferenceItem | null>(null);
  const isGuide = kind === 'guide' || kind === 'rules' || kind === 'news' || kind === 'changelog';
  const staticItems = isGuide
    ? (kind === 'guide'
      ? guideSections[activeTab]
      : kind === 'rules'
        ? ruleSections[activeTab]
        : kind === 'changelog'
          ? changelogSections[activeTab]
          : newsSections[activeTab]) ?? []
    : [];
  const taskShopLocked = kind === 'tasks' && activeTab === '任务商店';
  const mazeShopLocked = kind === 'maze' && activeTab === '迷宫商店';
  const activeTabIndex = Math.max(0, config.tabs.indexOf(activeTab));
  const tabId = `reference-tab-${kind}-${activeTabIndex}`;
  const panelId = `reference-panel-${kind}-${activeTabIndex}`;
  const referenceTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsVisible = !config.hideTabs && config.tabs.length > 0;
  const handleTabKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? config.tabs.length - 1
        : (activeTabIndex + (event.key === 'ArrowRight' ? 1 : -1) + config.tabs.length) % config.tabs.length;
    const nextTab = config.tabs[nextIndex];
    if (nextTab === undefined) return;
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => referenceTabRefs.current[nextIndex]?.focus());
  };
  return <section className={`reference-page reference-page--${kind}`}><header className="reference-page__header"><div><p className="page-card__eyebrow">{config.eyebrow}</p><h3>{config.title}</h3><p>{config.copy}</p></div></header>{tabsVisible ? <nav className="reference-page__tabs" role="tablist" aria-label={`${config.title}分类`} onKeyDown={handleTabKeyDown}>{config.tabs.map((tab, index) => <button key={tab} ref={(element) => { referenceTabRefs.current[index] = element; }} id={`reference-tab-${kind}-${index}`} className={tab === activeTab ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" role="tab" aria-selected={tab === activeTab} aria-controls={`reference-panel-${kind}-${index}`} tabIndex={tab === activeTab ? 0 : -1} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav> : null}<div className="reference-page__tabpanel" id={panelId} role="tabpanel" aria-labelledby={tabsVisible ? tabId : undefined} tabIndex={0}>{config.locked ? <LockedPanel config={config} activeTab={activeTab} /> : null}{taskShopLocked ? <LockedPanel config={config} activeTab={activeTab} copy="任务商店还没有可用商品和兑换操作。" /> : null}{mazeShopLocked ? <LockedPanel config={config} activeTab={activeTab} copy="迷宫商店还没有可用商品和兑换操作。" /> : null}{!config.locked && kind === 'tasks' && !taskShopLocked ? <TasksPanel characterId={session.character_id} activeTab={activeTab} onItemDetail={setDetail} /> : null}{!config.locked && kind === 'maze' && !mazeShopLocked ? <MazePanel characterId={session.character_id} activeTab={activeTab} onItemDetail={setDetail} /> : null}{!config.locked && isGuide ? <ContentPanel config={config} activeTab={activeTab} items={staticItems} onItemDetail={setDetail} /> : null}</div><GameDialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} eyebrow={config.eyebrow} title={detail?.title ?? activeTab} primaryLabel="已了解" onPrimary={() => setDetail(null)} primaryDisabled={detail === null}><p className="game-dialog__copy">{detail?.copy ?? config.copy}</p><div className="game-dialog__facts"><span>当前分类</span><strong>{activeTab}</strong></div><div className="game-dialog__facts"><span>数据状态</span><strong>{config.locked || taskShopLocked || mazeShopLocked ? '系统锁定' : '真实进度'}</strong></div></GameDialog></section>;
}
