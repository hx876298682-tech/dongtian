import { describe, expect, it } from 'vitest';

import { performanceScenarios, selectPerformanceScenarios } from './perf-scenarios.js';

describe('performance scenario catalog', () => {
  it('exposes the targeted capacity and fault scenarios', () => {
    expect(performanceScenarios.map((scenario) => scenario.id)).toEqual([
      'login-settle-10h',
      'mixed-authority-writes',
      'max-legal-segment',
      'worker-restart',
      'database-short-outage',
    ]);
  });

  it('supports scenario filtering without inventing new defaults', () => {
    const selected = selectPerformanceScenarios(['max-legal-segment']);
    expect(selected.map((scenario) => scenario.id)).toEqual(['max-legal-segment']);
  });
});

