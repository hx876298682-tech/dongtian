import type { ActionCatalogEntry, QueueMutation } from '@dongtian/contracts';

import {
  HERBALISM_PAGE_DEFINITION,
  BehaviorEmpty,
  BehaviorError,
  BehaviorLoading,
  BehaviorPage,
  BehaviorUnavailable,
} from './behavior-page.js';
import {
  describeHerbalismAction,
  findHerbalismActions,
  isBehaviorActionAvailable,
  startBehaviorAction,
  type BehaviorQueueClient,
  type StartBehaviorActionOptions,
} from './behavior-adapter.js';

export const HERBALISM_START_LABEL = '开始采集';
export { findHerbalismActions };

export function HerbalismLoading() {
  return <BehaviorLoading definition={HERBALISM_PAGE_DEFINITION} />;
}

export function HerbalismError({ onRetry }: { readonly onRetry: () => void | Promise<unknown> }) {
  return <BehaviorError definition={HERBALISM_PAGE_DEFINITION} onRetry={onRetry} />;
}

export function HerbalismEmpty() {
  return <BehaviorEmpty definition={HERBALISM_PAGE_DEFINITION} />;
}

export function HerbalismUnavailable() {
  return <BehaviorUnavailable title="当前没有可用的采药行动" />;
}

export function isHerbalismActionAvailable(action: ActionCatalogEntry): boolean {
  return isBehaviorActionAvailable(action);
}

export type HerbalismQueueClient = BehaviorQueueClient;
export type StartHerbalismActionOptions = StartBehaviorActionOptions & {
  readonly behaviorKind?: 'herbalism';
};

export async function startHerbalismAction(action: ActionCatalogEntry, options: StartHerbalismActionOptions): Promise<QueueMutation> {
  try {
    return await startBehaviorAction(action, { ...options, actionLabel: describeHerbalismAction, behaviorKind: 'herbalism' });
  } catch (error) {
    if (error instanceof Error && error.message === 'BEHAVIOR_ACTION_UNAVAILABLE') throw new Error('HERBALISM_ACTION_UNAVAILABLE');
    throw error;
  }
}

export function HerbalismPage() {
  return <BehaviorPage definition={HERBALISM_PAGE_DEFINITION} />;
}
