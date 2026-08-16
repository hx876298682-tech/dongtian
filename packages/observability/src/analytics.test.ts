import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_SENSITIVE_FIELD_BLACKLIST,
  CLIENT_EXPOSURE_EVENT_TYPES,
  SERVER_ANALYTICS_EVENT_TYPES,
  parseAnalyticsEvent,
  parseClientExposureEvent,
  parseServerAnalyticsEvent,
} from './analytics.js';

describe('analytics schemas', () => {
  it('accepts the required server event keys and keeps the event payload opaque', () => {
    const event = parseServerAnalyticsEvent({
      event_id: 'event-1',
      event_type: 'offline_settlement_completed',
      occurred_at: '2026-08-16T00:00:00.000Z',
      transaction_id: 'transaction-1',
      character_id: 'character-1',
      config_version: '2026.08.16.1',
      formula_version: 1,
      idempotency_key: 'idem-1',
      dedupe_key: 'dedupe-1',
      payload: {
        settlement_id: 'settlement-1',
        value_total: '12.5',
      },
    });

    expect(event.transaction_id).toBe('transaction-1');
    expect(event.payload).toMatchObject({
      settlement_id: 'settlement-1',
      value_total: '12.5',
    });
  });

  it('rejects sensitive fields and nested ip/email values', () => {
    expect(() => parseServerAnalyticsEvent({
      event_id: 'event-1',
      event_type: 'dungeon_run_finalized',
      occurred_at: '2026-08-16T00:00:00.000Z',
      transaction_id: 'transaction-1',
      character_id: 'character-1',
      config_version: '2026.08.16.1',
      formula_version: 1,
      idempotency_key: 'idem-1',
      dedupe_key: 'dedupe-1',
      payload: {
        email: 'player@example.com',
      },
    })).toThrow('ANALYTICS_VALIDATION_FAILED');

    expect(() => parseClientExposureEvent({
      event_id: 'event-2',
      event_type: 'dashboard_viewed',
      occurred_at: '2026-08-16T00:00:00.000Z',
      session_id: 'session-1',
      character_id: 'character-1',
      config_version: '2026.08.16.1',
      formula_version: 1,
      dedupe_key: 'dedupe-2',
      payload: {
        nested: [{ client_ip: '127.0.0.1' }],
      },
    })).toThrow('ANALYTICS_VALIDATION_FAILED');
  });

  it('exports the documented event type sets and blacklist entries', () => {
    expect(SERVER_ANALYTICS_EVENT_TYPES).toContain('dungeon_run_finalized');
    expect(CLIENT_EXPOSURE_EVENT_TYPES).toContain('dashboard_viewed');
    expect(ANALYTICS_SENSITIVE_FIELD_BLACKLIST).toContain('remote_ip');
    expect(parseAnalyticsEvent({
      event_id: 'event-3',
      event_type: 'queue_saved',
      occurred_at: '2026-08-16T00:00:00.000Z',
      transaction_id: 'transaction-3',
      character_id: 'character-3',
      config_version: '2026.08.16.1',
      formula_version: 1,
      idempotency_key: 'idem-3',
      dedupe_key: 'dedupe-3',
      payload: { diff: 'changed' },
    }).event_type).toBe('queue_saved');
  });
});
