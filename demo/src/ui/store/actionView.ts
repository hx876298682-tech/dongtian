/** primaryAction → 展示视图（“我正在做什么”）。
    只读取服务端字段并翻译为界面语言，不做任何收益演算。 */
import { TRAINING_CONFIG } from '../../game/config';
import type { Catalog, RemotePlayer } from '../api/client';
import type { ActionKind } from '../content/meta';
import { ACTION_VERB, techniqueName } from '../content/meta';

/** 表现层译名：内容包 recipe id 目前为 alchemy_basic； forge 配方释出后在此补一行即可。 */
const RECIPE_NAMES: Record<string, string> = {
  alchemy_basic: '聚气丹',
};

export type ActionView = {
  actionId: string;
  targetId: string | null;
  kind: ActionKind;
  verb: string;
  targetName: string;
  startedAtMs: number;
  carrySeconds: number;
  intervalSeconds: number;
  /** 该行动归属的导航 key：用于“此处正在运转”的卡片描边 */
  home: 'training' | 'alchemy' | 'forge' | 'technique_research' | 'treasure_research' | 'map' | 'gather';
  refId: string;
};

export function deriveActionView(player: RemotePlayer | null, catalog: Catalog | null): ActionView | null {
  const primary = player?.primaryAction;
  if (!player || !primary?.actionId || !primary.startedAt) return null;
  const actionId = primary.actionId;
  const targetId = primary.targetId ?? null;

  const map = catalog?.maps.find((m) => m.actionId === actionId && m.status !== 'content_pending');
  if (map) {
    return {
      actionId, targetId, kind: 'expedition', verb: ACTION_VERB.expedition,
      targetName: map.displayName, startedAtMs: Date.parse(primary.startedAt),
      carrySeconds: primary.carrySeconds ?? 0, intervalSeconds: map.targetKillTimeSeconds,
      home: 'map', refId: map.id,
    };
  }

  const gather = catalog?.gatheringMaps.find((g) => g.actionId === actionId && g.id === targetId);
  if (gather) {
    const kind: ActionKind = gather.actionId;
    return {
      actionId, targetId, kind, verb: ACTION_VERB[kind], targetName: gather.displayName,
      startedAtMs: Date.parse(primary.startedAt), carrySeconds: primary.carrySeconds ?? 0,
      intervalSeconds: gather.intervalSeconds, home: 'gather', refId: gather.id,
    };
  }

  if (actionId === 'technique_training') {
    return {
      actionId, targetId, kind: 'technique_training', verb: ACTION_VERB.technique_training,
      targetName: targetId ? techniqueName(targetId) : '研习功法',
      startedAtMs: Date.parse(primary.startedAt), carrySeconds: primary.carrySeconds ?? 0,
      intervalSeconds: Number(TRAINING_CONFIG.intervalSeconds), home: 'training', refId: targetId ?? '',
    };
  }

  if (actionId === 'alchemy') {
    const recipe = catalog?.recipes.find((r) => r.actionId === 'alchemy');
    return {
      actionId, targetId, kind: 'alchemy', verb: ACTION_VERB.alchemy,
      targetName: (targetId && (RECIPE_NAMES[targetId] ?? targetId)) ?? (recipe ? RECIPE_NAMES[recipe.id] ?? recipe.id : '炼丹'),
      startedAtMs: Date.parse(primary.startedAt), carrySeconds: primary.carrySeconds ?? 0,
      intervalSeconds: recipe?.intervalSeconds ?? 60, home: 'alchemy', refId: targetId ?? recipe?.id ?? '',
    };
  }

  if (actionId === 'forge') {
    const templateId = targetId?.includes(':') ? targetId.split(':')[1] : null;
    const template = templateId ? catalog?.equipmentTemplates.find((t) => t.id === templateId) : undefined;
    return {
      actionId, targetId, kind: 'forge', verb: ACTION_VERB.forge,
      targetName: template?.displayName ?? '锻造器物',
      startedAtMs: Date.parse(primary.startedAt), carrySeconds: primary.carrySeconds ?? 0,
      intervalSeconds: catalog?.recipes.find((r) => r.actionId === 'forge')?.intervalSeconds ?? 60,
      home: 'forge', refId: targetId ?? '',
    };
  }

  return {
    actionId, targetId, kind: 'training', verb: ACTION_VERB.training, targetName: '吐纳调息',
    startedAtMs: Date.parse(primary.startedAt), carrySeconds: primary.carrySeconds ?? 0,
    intervalSeconds: Number(TRAINING_CONFIG.intervalSeconds), home: 'training', refId: '',
  };
}

/** 场次计数是纯时间推导（允许），收益数字一律等流水。 */
export function completedCycles(view: ActionView, nowMs: number): number | null {
  if (!view.intervalSeconds || view.intervalSeconds <= 0) return null;
  return Math.max(0, Math.floor((nowMs - view.startedAtMs) / (view.intervalSeconds * 1000)));
}

/** 判定是否需要发起离线结算：有进行中的主行动且距上次结算超过 2 分钟，
    或灵田已存在成熟批次（无论是否有主行动）。 */
export function shouldOfferOfflineSettlement(
  player: { primaryAction: { actionId: string | null }; lastSettledAt: string },
  hasMaturedFarm: boolean,
  nowMs: number,
): boolean {
  const settledAgo = nowMs - Date.parse(player.lastSettledAt);
  if (hasMaturedFarm && player.primaryAction.actionId == null) return true;
  return Boolean(player.primaryAction.actionId) && settledAgo > 120_000;
}
