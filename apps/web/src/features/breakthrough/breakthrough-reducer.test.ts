import { describe, expect, it } from 'vitest';

import {
  breakthroughPageReducer,
  createInitialBreakthroughPageState,
} from './breakthrough-reducer.js';

describe('breakthrough page reducer', () => {
  it('hydrates the same active run from URL recovery state', () => {
    const state = createInitialBreakthroughPageState('run-1');
    const next = breakthroughPageReducer(state, {
      type: 'hydrate-run',
      run: {
        breakthrough_run_id: 'run-1',
        status: 'TRIAL_WAITING_CHOICE',
        current_node_id: 'node.choice',
        run_version: 2,
      },
    });

    expect(next.runId).toBe('run-1');
    expect(next.status).toBe('TRIAL_WAITING_CHOICE');
    expect(next.currentNodeId).toBe('node.choice');
    expect(next.runVersion).toBe(2);
  });

  it('keeps an idempotency key across a failed start so retry uses the same key', () => {
    const state = breakthroughPageReducer(createInitialBreakthroughPageState(), {
      type: 'prepare-start',
      idempotencyKey: 'idem-1',
    });
    const failed = breakthroughPageReducer(state, { type: 'start-failed', message: 'network' });

    expect(failed.pendingIdempotencyKey).toBe('idem-1');
    expect(failed.lastError).toBe('network');
  });

  it('clears the start key after abandon so the next start cannot replay the old request', () => {
    const state = breakthroughPageReducer(createInitialBreakthroughPageState(), {
      type: 'prepare-start',
      idempotencyKey: 'idem-1',
    });
    const cleared = breakthroughPageReducer(state, { type: 'clear-pending-start' });
    expect(cleared.pendingIdempotencyKey).toBeNull();
  });
});
