import type { OutboxEvent } from '@dongtian/database';
import {
  isClientExposureEventType,
  isServerAnalyticsEventType,
  parseAnalyticsEvent,
  type AnalyticsEvent,
} from '@dongtian/observability';

export type AnalyticsDedupeStore = {
  readonly hasProcessed: (dedupeKey: string) => Promise<boolean>;
  readonly markProcessed: (dedupeKey: string) => Promise<void>;
};

export type AnalyticsSink = {
  readonly record: (event: AnalyticsEvent) => Promise<void>;
};

export type AnalyticsOutboxHandlerOptions = Readonly<{
  readonly sink: AnalyticsSink;
  readonly dedupeStore: AnalyticsDedupeStore;
  readonly logger?: Readonly<{
    info?: (...args: readonly unknown[]) => void;
    warn?: (...args: readonly unknown[]) => void;
    error?: (...args: readonly unknown[]) => void;
  }>;
}>;

function isAnalyticsEventType(eventType: string): boolean {
  return isServerAnalyticsEventType(eventType) || isClientExposureEventType(eventType);
}

export function createAnalyticsOutboxHandler(options: AnalyticsOutboxHandlerOptions): (event: OutboxEvent) => Promise<void> {
  return async (event: OutboxEvent) => {
    if (!isAnalyticsEventType(event.eventType)) {
      options.logger?.info?.(`Skipping non-analytics outbox event: ${event.eventType}`);
      return;
    }

    const parsed = parseAnalyticsEvent(event.payload);
    if (parsed.event_type !== event.eventType) {
      throw new Error('ANALYTICS_EVENT_TYPE_MISMATCH');
    }

    if (await options.dedupeStore.hasProcessed(parsed.dedupe_key)) {
      options.logger?.info?.(`Skipping duplicated analytics event: ${parsed.dedupe_key}`);
      return;
    }

    await options.sink.record(parsed);
    await options.dedupeStore.markProcessed(parsed.dedupe_key);
  };
}
