import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import type { AuthActiveSession, DungeonOpportunityResponse, Queue, QueueEntry } from '@dongtian/contracts';
import { apiClient } from '../../lib/api.js';
import { GameDialog } from '../../components/game-dialog.js';
import { buildIdleProgressView, describeAction, describeItem } from '../dashboard/dashboard-adapter.js';

type ReferencePageKind = 'tasks' | 'maze' | 'shops' | 'achievements' | 'leaderboard' | 'guild' | 'social' | 'guide' | 'rules' | 'news';
type ReferenceItem = { readonly title: string; readonly copy: string; readonly state?: string; readonly href?: string };
interface ReferencePageConfig { readonly title: string; readonly eyebrow: string; readonly copy: string; readonly tabs: readonly string[]; readonly locked?: string }

const CONFIG: Record<ReferencePageKind, ReferencePageConfig> = {
  tasks: { title: '修行任务', eyebrow: '任务', copy: '把当前修行拆成清晰的目标，完成后回到洞府领取收获。', tabs: ['当前任务', '已完成', '目标'] },
  maze: { title: '秘境迷宫', eyebrow: '迷宫', copy: '准备路线、查看房间并继续你的秘境探险。', tabs: ['迷宫', '房间', '自动化'] },
  shops: { title: '洞天商店', eyebrow: '商店', copy: '这里预留修仙资源兑换和秘境补给入口。', tabs: ['杂货', '秘境', '兑换'], locked: '坊市和商店经济系统属于延期系统，开放后接入真实商品、价格和购买操作。' },
  achievements: { title: '修行成就', eyebrow: '成就', copy: '记录你在修炼、炼丹、秘境和突破路上的里程碑。', tabs: ['成就', '收藏', '妖兽图鉴'], locked: '成就、收藏和妖兽图鉴暂未开放，当前不虚构完成状态。' },
  leaderboard: { title: '修行榜', eyebrow: '排行榜', copy: '比较不同修行方向的成长记录。', tabs: ['总榜', '修炼', '秘境'], locked: '排行榜需要独立的统计与快照服务，当前不显示假排名。' },
  guild: { title: '宗门', eyebrow: '宗门', copy: '加入宗门，与其他修士共同修行。', tabs: ['宗门', '成员', '公告'], locked: '宗门与多人协作属于延期系统，开放后接入真实成员和权限。' },
  social: { title: '仙友', eyebrow: '社交', copy: '管理仙友、私信和组队关系。', tabs: ['仙友', '推荐', '屏蔽'], locked: '社交与多人系统属于延期系统，当前不伪造玩家和消息。' },
  guide: { title: '修行指南', eyebrow: '指南', copy: '从第一次挂机到筑基突破，逐步了解洞天里的修行方式。', tabs: ['入门', '修炼', '生产', '秘境'] },
  rules: { title: '修行规则', eyebrow: '规则', copy: '查看挂机、结算、突破和秘境的基础规则。', tabs: ['挂机', '资源', '突破', '秘境'] },
  news: { title: '洞天日志', eyebrow: '更新', copy: '查看洞天近期开放的玩法和规则变化。', tabs: ['最近更新', '规则记录'] },
};

const guideSections: Record<string, readonly ReferenceItem[]> = { 入门: [{ title: '第一次挂机', copy: '进入洞府后选择任务，点击任务卡即可开始。' }, { title: '离线收获', copy: '回来后查看结算摘要，领取修为和物品。' }], 修炼: [{ title: '境界成长', copy: '修为达到门槛后，在修炼页准备突破材料。' }], 生产: [{ title: '材料生产', copy: '生产页会按已开放配方和库存显示可执行内容。' }], 秘境: [{ title: '路线探险', copy: '准备装备和路线，完成秘境后领取探险结果。' }] };
const ruleSections: Record<string, readonly ReferenceItem[]> = { 挂机: [{ title: '挂机结算', copy: '队列按照任务顺序执行，材料不足时按策略处理。' }], 资源: [{ title: '资源变化', copy: '每轮任务完成后记录修为、灵石和物品变化。' }], 突破: [{ title: '突破条件', copy: '达到境界门槛并满足材料条件后才可突破。' }], 秘境: [{ title: '探险结算', copy: '战斗与路线完成后，系统按真实结果发放收获。' }] };
const newsSections: Record<string, readonly ReferenceItem[]> = { 最近更新: [{ title: '当前进展', copy: '洞天已开放挂机、修炼、生产、装备、背包和秘境流程。', state: '已上线' }], 规则记录: [{ title: '下一阶段', copy: '继续补齐参考式页面交互和真实系统。', state: '规划中' }] };
const statusLabel: Record<string, string> = { RUNNING: '进行中', QUEUED: '待执行', DONE: '已完成', DONE_INCOMPLETE: '已完成', DONE_CONDITION_MET: '已完成', BLOCKED: '已阻塞', CANCELLED: '已取消' };
const completedTaskStatuses = new Set<QueueEntry['status']>(['DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET']);

function queueEntriesWithCurrent(queue: Queue): readonly QueueEntry[] {
  if (queue.current === null || queue.entries.some((entry) => entry.entry_id === queue.current?.entry_id)) return queue.entries;
  return [queue.current, ...queue.entries];
}

export function selectTaskItemsByTab(queue: Queue, activeTab: string): readonly QueueEntry[] {
  const entries = queueEntriesWithCurrent(queue);
  if (activeTab === '当前任务') return entries.filter((entry) => entry.entry_id === queue.current?.entry_id || entry.status === 'RUNNING' || entry.status === 'QUEUED');
  if (activeTab === '已完成') return entries.filter((entry) => completedTaskStatuses.has(entry.status));
  if (activeTab === '目标') return entries.filter((entry) => entry.target_value !== null || entry.condition_item_id !== null);
  return [];
}

function ItemList({ items, emptyCopy = '暂无可展示记录', onItemDetail }: { readonly items: readonly ReferenceItem[]; readonly emptyCopy?: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const [filter, setFilter] = useState('全部');
  const filtered = filter === '全部' ? items : items.filter((item) => item.state === filter);
  return <div className="reference-list-panel"><div className="reference-list-panel__filters" aria-label="筛选"><span>筛选</span>{['全部', '进行中', '已完成'].map((value) => <button key={value} className={filter === value ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>{filtered.length === 0 ? <div className="reference-empty-state"><strong>{emptyCopy}</strong><p>当前分类没有可用数据，系统不会用示例记录代替真实结果。</p></div> : <div className="reference-guide-list">{filtered.map((item) => <article key={item.title} className="reference-guide-card"><span className="reference-task-card__state">{item.state ?? '参考说明'}</span><h4>{item.title}</h4><p>{item.copy}</p><button className="ghost-button" type="button" onClick={() => onItemDetail(item)}>查看详情</button>{item.href ? <Link className="ghost-button" to={item.href}>前往操作</Link> : null}</article>)}</div>}</div>;
}

function describeTaskTarget(entry: QueueEntry): string | null {
  if (entry.target_value === null || entry.target_value === '') return null;
  if (entry.mode === 'DURATION') return `持续 ${entry.target_value} 秒`;
  if (entry.mode === 'COUNT') return `目标 ${entry.target_value} 次`;
  if (entry.mode === 'UNTIL_INVENTORY' && entry.condition_item_id !== null) return `库存 ${describeItem(entry.condition_item_id)} ${entry.condition_operator ?? '达到'} ${entry.target_value}`;
  return `目标 ${entry.target_value}`;
}

function queueEntryToItem(entry: QueueEntry, title = describeAction(entry.action_id), href = '/dashboard#queue'): ReferenceItem {
  const target = describeTaskTarget(entry);
  return { title, copy: `${target === null ? '' : `${target}，`}已完成 ${entry.completed_cycles} 轮。`, state: statusLabel[entry.status] ?? '待执行', href };
}

function TasksPanel({ characterId, activeTab, onItemDetail }: { readonly characterId: string; readonly activeTab: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const queueQuery = useQuery<Queue>({ queryKey: ['reference-tasks', characterId], queryFn: () => apiClient.getQueue(characterId), staleTime: 10_000 });
  const currentView = queueQuery.data === undefined ? null : buildIdleProgressView(queueQuery.data);
  const currentEntryId = queueQuery.data?.current?.entry_id;
  const selectedEntries = queueQuery.data === undefined ? [] : selectTaskItemsByTab(queueQuery.data, activeTab);
  const items = selectedEntries.map((entry) => queueEntryToItem(entry, entry.entry_id === currentEntryId ? currentView?.actionLabel ?? describeAction(entry.action_id) : describeAction(entry.action_id), entry.entry_id === currentEntryId ? '/dashboard' : '/dashboard#queue'));
  const emptyCopy = activeTab === '已完成' ? '还没有完成修行任务' : activeTab === '目标' ? '队列中暂无目标' : '还没有安排修行任务';
  return <ItemList items={items} emptyCopy={emptyCopy} onItemDetail={onItemDetail} />;
}

function MazePanel({ characterId, activeTab, onItemDetail }: { readonly characterId: string; readonly activeTab: string; readonly onItemDetail: (item: ReferenceItem) => void }): ReactElement {
  const opportunityQuery = useQuery<DungeonOpportunityResponse>({ queryKey: ['reference-maze', characterId], queryFn: () => apiClient.getDungeonOpportunities(characterId), staleTime: 10_000 });
  const current = opportunityQuery.data?.opportunity.current_opportunities ?? 0;
  const cap = opportunityQuery.data?.opportunity.opportunity_cap ?? 0;
  const items: readonly ReferenceItem[] = activeTab === '迷宫' ? [{ title: '青蛇洞', copy: `今日可用探险机会 ${current}/${cap}。`, state: current > 0 ? '可进入' : '机会用尽', href: '/expedition' }] : activeTab === '房间' ? [{ title: '入口石径', copy: '选择初始路线并确认装备。' }, { title: '蛇窟岔路', copy: '根据风险选择稳妥或深入路线。' }, { title: '深潭石台', copy: '完成战斗后整理秘境收获。' }] : [{ title: '自动选择安全路线', copy: '秘境页会使用角色当前保存的装备方案和战斗策略。', href: '/expedition' }];
  return <ItemList items={items} emptyCopy="暂无可查看的迷宫记录" onItemDetail={onItemDetail} />;
}

function LockedPanel({ config, activeTab }: { readonly config: ReferencePageConfig; readonly activeTab: string }): ReactElement { return <div className="reference-locked-panel"><span className="reference-task-card__state">系统锁定</span><h4>{activeTab}暂未开放</h4><p>{config.locked}</p><p>当前没有真实记录可展示，暂不伪造商品、排名、成员或消息。</p><button className="ghost-button" type="button" disabled>等待系统开放</button></div>; }

export function ReferencePage({ kind }: { readonly kind: ReferencePageKind }): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const config = CONFIG[kind];
  const [activeTab, setActiveTab] = useState(config.tabs[0] ?? '总览');
  const [detail, setDetail] = useState<ReferenceItem | null>(null);
  const isGuide = kind === 'guide' || kind === 'rules' || kind === 'news';
  const staticItems = isGuide ? (kind === 'guide' ? guideSections[activeTab] : kind === 'rules' ? ruleSections[activeTab] : newsSections[activeTab]) ?? [] : [];
  return <section className="reference-page"><header className="reference-page__header"><div><p className="page-card__eyebrow">{config.eyebrow}</p><h3>{config.title}</h3></div><p>{config.copy}</p></header><nav className="reference-page__tabs" aria-label={`${config.title}分类`}>{config.tabs.map((tab) => <button key={tab} className={tab === activeTab ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" aria-pressed={tab === activeTab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>{config.locked ? <LockedPanel config={config} activeTab={activeTab} /> : null}{!config.locked && kind === 'tasks' ? <TasksPanel characterId={session.character_id} activeTab={activeTab} onItemDetail={setDetail} /> : null}{!config.locked && kind === 'maze' ? <MazePanel characterId={session.character_id} activeTab={activeTab} onItemDetail={setDetail} /> : null}{!config.locked && isGuide ? <ItemList items={staticItems} onItemDetail={setDetail} /> : null}<GameDialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} eyebrow={config.eyebrow} title={detail?.title ?? activeTab} primaryLabel="已了解" onPrimary={() => setDetail(null)} primaryDisabled={detail === null}><p className="game-dialog__copy">{detail?.copy ?? config.copy}</p><div className="game-dialog__facts"><span>当前分类</span><strong>{activeTab}</strong></div><div className="game-dialog__facts"><span>数据状态</span><strong>{config.locked ? '系统锁定' : '参考说明 / 真实进度'}</strong></div></GameDialog></section>;
}
