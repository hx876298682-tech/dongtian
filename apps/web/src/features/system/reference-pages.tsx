import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import type { AuthActiveSession, DungeonOpportunityResponse, Queue } from '@dongtian/contracts';
import { LockedStateScreen } from '@dongtian/ui';
import { apiClient } from '../../lib/api.js';
import { GameDialog } from '../../components/game-dialog.js';
import { buildIdleProgressView } from '../dashboard/dashboard-adapter.js';

type ReferencePageKind = 'tasks' | 'maze' | 'shops' | 'achievements' | 'leaderboard' | 'guild' | 'social' | 'guide' | 'rules' | 'news';

interface ReferencePageConfig {
  readonly title: string;
  readonly eyebrow: string;
  readonly copy: string;
  readonly tabs: readonly string[];
  readonly locked?: string;
}

const CONFIG: Record<ReferencePageKind, ReferencePageConfig> = {
  tasks: { title: '修行任务', eyebrow: '任务', copy: '把当前修行拆成清晰的目标，完成后回到洞府领取收获。', tabs: ['当前任务', '已完成', '目标'] },
  maze: { title: '秘境迷宫', eyebrow: '迷宫', copy: '准备路线、查看房间并继续你的秘境探险。', tabs: ['迷宫', '房间', '自动化'] },
  shops: { title: '洞天商店', eyebrow: '商店', copy: '这里预留修仙资源兑换和秘境补给入口。', tabs: ['杂货', '秘境', '兑换'], locked: '坊市和商店经济系统属于延期系统，后端开放后接入真实商品、价格和购买操作。' },
  achievements: { title: '修行成就', eyebrow: '成就', copy: '记录你在修炼、炼丹、秘境和突破路上的里程碑。', tabs: ['成就', '收藏', '妖兽图鉴'], locked: '成就、收藏和妖兽图鉴的持久化接口尚未开放，当前不伪造完成状态。' },
  leaderboard: { title: '修行榜', eyebrow: '排行榜', copy: '比较不同修行方向的成长记录。', tabs: ['总榜', '修炼', '秘境'], locked: '排行榜需要独立的统计与快照服务，当前不显示假排名。' },
  guild: { title: '宗门', eyebrow: '宗门', copy: '加入宗门，与其他修士共同修行。', tabs: ['宗门', '成员', '公告'], locked: '宗门与多人协作属于延期系统，后端开放后接入真实成员和权限。' },
  social: { title: '仙友', eyebrow: '社交', copy: '管理仙友、私信和组队关系。', tabs: ['仙友', '推荐', '屏蔽'], locked: '社交与多人系统属于延期系统，当前不伪造玩家和消息。' },
  guide: { title: '修行指南', eyebrow: '指南', copy: '从第一次挂机到筑基突破，逐步了解洞天里的修行方式。', tabs: ['入门', '修炼', '生产', '秘境'] },
  rules: { title: '修行规则', eyebrow: '规则', copy: '查看挂机、结算、突破和秘境的基础规则。', tabs: ['挂机', '资源', '突破', '秘境'] },
  news: { title: '洞天日志', eyebrow: '更新', copy: '查看洞天近期开放的玩法和规则变化。', tabs: ['最近更新', '版本记录'] },
};

function TasksPanel({ characterId }: { readonly characterId: string }): ReactElement {
  const queueQuery = useQuery<Queue>({ queryKey: ['reference-tasks', characterId], queryFn: () => apiClient.getQueue(characterId), staleTime: 10_000 });
  const current = queueQuery.data?.current ?? queueQuery.data?.entries[0];
  const currentView = queueQuery.data === undefined ? null : buildIdleProgressView(queueQuery.data);
  return (
    <div className="reference-task-list">
      <article className="reference-task-card reference-task-card--active">
        <span className="reference-task-card__state">{current === undefined ? '等待安排' : '正在进行'}</span>
        <h4>{current === undefined ? '还没有开始修行' : currentView?.actionLabel ?? '当前挂机任务'}</h4>
        <p>{current === undefined ? '回到洞府选择一个任务，角色会立即开始挂机。' : '角色会持续完成当前任务，离线后回来领取收益。'}</p>
        <Link className="ghost-button" to="/dashboard">查看挂机</Link>
      </article>
      <article className="reference-task-card"><span className="reference-task-card__state">下一步</span><h4>筑基准备</h4><p>修为、材料和条件会随着挂机进度持续更新。</p><Link className="ghost-button" to="/cultivation">查看突破</Link></article>
    </div>
  );
}

function MazePanel({ characterId, activeTab }: { readonly characterId: string; readonly activeTab: string }): ReactElement {
  const opportunityQuery = useQuery<DungeonOpportunityResponse>({ queryKey: ['reference-maze', characterId], queryFn: () => apiClient.getDungeonOpportunities(characterId), staleTime: 10_000 });
  if (activeTab === '迷宫') {
    const current = opportunityQuery.data?.opportunity.current_opportunities ?? 0;
    const cap = opportunityQuery.data?.opportunity.opportunity_cap ?? 0;
    return <div className="reference-task-list"><article className="reference-task-card reference-task-card--active"><span className="reference-task-card__state">今日机会 {current}/{cap}</span><h4>青蛇洞</h4><p>准备装备和路线，进入洞窟寻找修炼材料。</p><Link className="ghost-button" to="/expedition">进入迷宫</Link></article></div>;
  }
  if (activeTab === '房间') {
    return <div className="reference-guide-list">{[['入口石径', '选择初始路线并确认装备。'], ['蛇窟岔路', '根据风险选择稳妥或深入路线。'], ['深潭石台', '完成战斗后整理秘境收获。']].map(([title, copy]) => <article key={title} className="reference-guide-card"><h4>{title}</h4><p>{copy}</p></article>)}</div>;
  }
  return <div className="reference-task-list"><article className="reference-task-card"><span className="reference-task-card__state">稳妥策略</span><h4>自动选择安全路线</h4><p>秘境页会使用角色当前保存的装备方案和战斗策略。</p><Link className="ghost-button" to="/expedition">编辑自动化</Link></article></div>;
}

function GuidePanel({ kind }: { readonly kind: ReferencePageKind }): ReactElement {
  const sections: Record<string, readonly [string, string][]> = {
    guide: [['第一次挂机', '进入洞府后选择任务，点击任务卡即可开始。'], ['离线收获', '离开一段时间后回来，结算摘要会显示修为和物品。'], ['继续突破', '在修炼页查看下一境界条件，准备好材料后开始突破。']],
    rules: [['挂机结算', '队列会按照任务顺序执行，材料不足时可以回到修炼。'], ['修为成长', '每轮任务完成后获得修为，达到境界门槛后开放突破。'], ['秘境探险', '秘境需要准备装备和路线，完成路线后再领取探险结果。']],
    news: [['当前版本', '洞天已开放挂机、修炼、生产、装备、背包和秘境流程。'], ['下一阶段', '会继续补齐参考式页面交互和真实后端系统。']],
  };
  const selectedSections = sections[kind] ?? sections['guide'] ?? [];
  return <div className="reference-guide-list">{selectedSections.map(([title, copy]) => <article key={title} className="reference-guide-card"><h4>{title}</h4><p>{copy}</p></article>)}</div>;
}

export function ReferencePage({ kind }: { readonly kind: ReferencePageKind }): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const config = CONFIG[kind];
  const [activeTab, setActiveTab] = useState(config.tabs[0] ?? '总览');
  const [detailOpen, setDetailOpen] = useState(false);
  const isGuide = kind === 'guide' || kind === 'rules' || kind === 'news';
  return (
    <section className="reference-page">
      <header className="reference-page__header"><div><p className="page-card__eyebrow">{config.eyebrow}</p><h3>{config.title}</h3></div><p>{config.copy}</p></header>
      <nav className="reference-page__tabs" aria-label={`${config.title}分类`}>
        {config.tabs.map((tab) => <button key={tab} className={tab === activeTab ? 'reference-page__tab reference-page__tab--active' : 'reference-page__tab'} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}
        <button className="reference-page__detail-button" type="button" onClick={() => setDetailOpen(true)}>查看详情</button>
      </nav>
      {config.locked ? <LockedStateScreen title={`${activeTab}暂未开放`} description={config.locked} /> : null}
      {!config.locked && kind === 'tasks' ? <TasksPanel characterId={session.character_id} /> : null}
      {!config.locked && kind === 'maze' ? <MazePanel characterId={session.character_id} activeTab={activeTab} /> : null}
      {!config.locked && isGuide ? <GuidePanel kind={kind} /> : null}
      <GameDialog open={detailOpen} onOpenChange={setDetailOpen} eyebrow={config.eyebrow} title={activeTab}>
        <p className="game-dialog__copy">{config.locked ?? config.copy}</p>
        <div className="game-dialog__facts"><span>当前分类</span><strong>{activeTab}</strong></div>
        <div className="game-dialog__facts"><span>角色数据</span><strong>{config.locked ? '等待对应系统开放' : '使用洞天角色当前进度'}</strong></div>
      </GameDialog>
    </section>
  );
}
