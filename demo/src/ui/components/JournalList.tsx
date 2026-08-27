/** 入库流水列表：数据来自 GET /v1/collection/events（durable event stream）。
    payload 形状按事件类型防御式提取；不认识的类型只展示事件名。 */
import { EmptyHint } from './primitives';
import type { CollectionEventItem } from '../api/client';
import type { ResourceId } from '../content/meta';
import { RESOURCE_META } from '../content/meta';
import { fmtNum, fmtTimeOfDay } from '../api/format';

const EVENT_LABELS: Record<string, string> = {
  spirit_farm_planted: '灵田播种',
  spirit_farm_plot_planted: '灵田播种',
  spirit_farm_harvested: '灵田成熟入库',
  settlement_committed: '挂机结算入库',
  production_inlined: '生产入库',
  skill_gained: '技艺精进',
  action_started: '开始行动',
  action_switched: '切换行动',
  action_stopped: '收功结算',
  breakthrough: '境界突破',
  equipment_reinforced: '装备强化',
  equipment_equipped: '装备穿戴',
  equipment_unequipped: '装备卸下',
  equipment_locked: '装备锁定',
  equipment_unlocked: '装备解锁',
  equipment_salvaged: '装备分解',
  equipment_sold: '装备出售',
};

function describeEvent(event: CollectionEventItem): { text: string; gain: string | null; loss: boolean } {
  const label = EVENT_LABELS[event.eventType] ?? prettify(event.eventType);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const gains: string[] = [];
  let loss = false;

  const resourceDelta = pickNumberRecord(payload.resourceDelta ?? payload['data']);
  for (const [key, value] of Object.entries(resourceDelta)) {
    const meta = RESOURCE_META[key as ResourceId];
    if (!meta || !Number.isFinite(value) || value === 0) continue;
    gains.push(`${meta.name} ${value > 0 ? '+' : ''}${fmtNum(value)}`);
    if (value < 0) loss = true;
  }

  const cultivation = payload.cultivationDelta;
  if (typeof cultivation === 'number' && cultivation !== 0) {
    gains.push(`修为 ${cultivation > 0 ? '+' : ''}${fmtNum(cultivation)}`);
    if (cultivation < 0) loss = true;
  }
  const completed = payload.completedActions;
  if (typeof completed === 'number' && completed > 0) {
    gains.push(`完成 ${fmtNum(completed)} 次`);
  }

  const production = pickNumberRecord(payload.productionDelta);
  for (const [key, value] of Object.entries(production)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    gains.push(`${prettify(key)} ×${fmtNum(value)}`);
  }

  return { text: label, gain: gains.length ? gains.join(' · ') : null, loss };
}

function pickNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function prettify(raw: string): string {
  return raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function JournalList({ events, emptyText }: { events: CollectionEventItem[]; emptyText: string }) {
  if (events.length === 0) return <EmptyHint text={emptyText} />;
  return (
    <div className="journal-panel">
      {events.map((event) => {
        const { text, gain, loss } = describeEvent(event);
        return (
          <div key={event.eventId} className="journal-row">
            <span className="journal-time">{fmtTimeOfDay(event.createdAt)}</span>
            <span className="journal-text">{text}</span>
            <span className={`journal-gain${loss ? ' loss' : ''}`}>{gain ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}
