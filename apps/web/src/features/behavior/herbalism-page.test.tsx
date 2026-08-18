import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, type ActionCatalogEntry, type Queue, type QueueMutation } from '@dongtian/contracts';

import {
  HerbalismEmpty,
  HerbalismError,
  HerbalismLoading,
  HerbalismUnavailable,
  isHerbalismActionAvailable,
  startHerbalismAction,
} from './herbalism-page.js';
import herbalismSource from './herbalism-page.tsx?raw';

function makeAction(overrides: Partial<ActionCatalogEntry> = {}): ActionCatalogEntry {
  return {
    action_id: 'action.t1.herb_baicao_valley',
    queue_action_id: 'action.t1.herb_baicao_valley',
    name_key: 'action.herb_baicao_valley.name',
    description_key: null,
    skill_id: 'skill.herbalism',
    enabled: true,
    unlocked: true,
    unlock_state: { enabled: true, visible: true, usable: true, optimized_ui: true, reason_key: null, reason: '', blockers: [] },
    can_add_to_queue: true,
    base_duration_us: '100000000',
    skill_xp: '4',
    cultivation_xp: '0',
    allowed_queue_modes: ['INFINITE'],
    required_tool_tag: 'herbalism_tool',
    modifier_tags: ['herbalism'],
    tags: ['gathering', 'herb'],
    inputs: [],
    outputs: [{ item_id: 'item.t1.qingling_herb', quantity: '1', source_routes: [], usage_routes: [] }],
    ...overrides,
  };
}

function makeQueue(version: string, paused: boolean): Queue {
  return { queue_version: version, paused, pending_replace_after_cycle: false, fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' }, current: null, entries: [], as_of: '2026-08-17T00:00:00.000Z' };
}

function makeMutation(queue: Queue): QueueMutation {
  return { queue_version: queue.queue_version, effective_at: queue.as_of, pending_replace_after_cycle: false, paused: queue.paused, queue };
}

describe('herbalism page', () => {
  it('renders clear loading, error, and unavailable states', () => {
    expect(renderToStaticMarkup(<HerbalismLoading />)).toContain('正在读取采药地图');
    expect(renderToStaticMarkup(<HerbalismError onRetry={() => undefined} />)).toContain('采药内容读取失败');
    expect(renderToStaticMarkup(<HerbalismEmpty />)).toContain('暂无可执行采药区域');
    expect(renderToStaticMarkup(<HerbalismUnavailable />)).toContain('当前没有可用的采药行动');
  });

  it('keeps the page as a region-first herbalism surface', () => {
    expect(herbalismSource).toContain('BehaviorPage');
    expect(herbalismSource).toContain('开始采集');
    expect(herbalismSource).toContain('startBehaviorAction');
  });

  it('writes one infinite entry, resumes a paused queue, invalidates global progress, and emits feedback', async () => {
    const queue = makeQueue('7', true);
    const resumedQueue = makeQueue('9', false);
    const client = {
      getQueue: vi.fn(),
      saveQueue: vi.fn().mockResolvedValue(makeMutation(queue)),
      resumeQueue: vi.fn().mockResolvedValue(makeMutation(resumedQueue)),
    };
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const emitFeedback = vi.fn();

    await startHerbalismAction(makeAction(), { characterId: 'character-1', queue, client, invalidate, emitFeedback, createIdempotencyKey: () => 'key' });

    const request = client.saveQueue.mock.calls[0]?.[1];
    expect(request.entries).toHaveLength(1);
    expect(request.entries[0]).toMatchObject({ action_id: 'action.t1.herb_baicao_valley', mode: 'INFINITE' });
    expect(client.resumeQueue).toHaveBeenCalledWith('character-1', { expected_queue_version: '7' }, 'key');
    expect(invalidate.mock.calls.map(([queryKey]) => queryKey)).toEqual([
      ['behavior', 'character-1', 'queue'],
      ['behavior', 'character-1', 'actions'],
      ['behavior', 'character-1', 'recipes'],
      ['behavior', 'character-1', 'progression'],
      ['dashboard', 'character-1'],
      ['global-idle-progress', 'character-1'],
    ]);
    expect(emitFeedback).toHaveBeenCalledWith('已开始挂机：百草谷采药');
  });

  it('retries once against the latest queue version after a conflict', async () => {
    const queue = makeQueue('7', false);
    const latestQueue = makeQueue('8', false);
    const client = {
      getQueue: vi.fn().mockResolvedValue(latestQueue),
      saveQueue: vi.fn()
        .mockRejectedValueOnce(new ApiClientError('conflict', { status: 409, retryable: false }))
        .mockResolvedValueOnce(makeMutation(latestQueue)),
      resumeQueue: vi.fn(),
    };

    await startHerbalismAction(makeAction(), { characterId: 'character-1', queue, client, invalidate: vi.fn(), createIdempotencyKey: () => 'key' });

    expect(client.getQueue).toHaveBeenCalledWith('character-1');
    expect(client.saveQueue).toHaveBeenCalledTimes(2);
    expect(client.saveQueue.mock.calls[1]?.[1].expected_queue_version).toBe('8');
  });

  it('rejects locked or non-infinite actions before touching the queue', async () => {
    const lockedAction = makeAction({ unlocked: false, allowed_queue_modes: ['INFINITE'] });
    const nonInfiniteAction = makeAction({ allowed_queue_modes: ['COUNT'] });
    const client = { getQueue: vi.fn(), saveQueue: vi.fn(), resumeQueue: vi.fn() };

    expect(isHerbalismActionAvailable(lockedAction)).toBe(false);
    expect(isHerbalismActionAvailable(nonInfiniteAction)).toBe(false);
    await expect(startHerbalismAction(lockedAction, { characterId: 'character-1', queue: makeQueue('1', false), client, invalidate: vi.fn() })).rejects.toThrow('HERBALISM_ACTION_UNAVAILABLE');
    expect(client.saveQueue).not.toHaveBeenCalled();
  });
});
