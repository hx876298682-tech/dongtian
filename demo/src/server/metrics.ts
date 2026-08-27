import type { ResourceId } from './types.ts';

export type SettlementMetric = 'success' | 'rejected' | 'duplicate' | 'stale';
export type ActivityMetric = 'success' | 'failure' | 'gate' | 'cooldown';
export type EquipmentGrowthMetric = 'reinforce' | 'promote' | 'awaken';

export type MetricsEvent = {
  type:
    | 'settlement_success'
    | 'settlement_rejected'
    | 'settlement_duplicate'
    | 'settlement_stale'
    | 'map_success'
    | 'map_failure'
    | 'map_gate'
    | 'map_cooldown'
    | 'dungeon_success'
    | 'dungeon_failure'
    | 'dungeon_gate'
    | 'dungeon_cooldown'
    | 'inventory_full'
    | 'resource_update'
    | 'equipment_growth'
    | 'settlement_pending'
    | 'drop_observation'
    | 'economic_anomaly';
  at?: Date | number | string;
  durationMs?: number;
  pendingAgeMs?: number;
  resourceDelta?: Partial<Record<ResourceId, number>>;
  resourceOverflow?: Partial<Record<ResourceId, number>>;
  growth?: EquipmentGrowthMetric;
  dropKey?: string;
  dropExpected?: number;
  dropActual?: number;
  anomalyKey?: string;
  anomalyValue?: number;
};

export type MetricAggregate = {
  count: number;
  totalMs: number;
  maxMs: number;
  averageMs: number;
};

export type ResourceMetric = { delta: number; overflow: number };
export type DropMetric = { expected: number; actual: number; absoluteDeviation: number };
export type MetricsSnapshot = {
  generatedAt: string;
  settlements: Record<SettlementMetric, number>;
  map: Record<ActivityMetric, number>;
  dungeon: Record<ActivityMetric, number>;
  inventoryFull: number;
  equipmentGrowth: Record<EquipmentGrowthMetric, number>;
  settlementDuration: MetricAggregate;
  pendingAge: MetricAggregate;
  resources: Record<ResourceId, ResourceMetric>;
  pendingSettlements: number;
  drops: Record<string, DropMetric>;
  economicAnomalies: Record<string, number>;
};

export type MetricsThresholds = {
  settlementRejected?: number;
  settlementDuplicate?: number;
  settlementStale?: number;
  settlementDurationMaxMs?: number;
  pendingAgeMaxMs?: number;
  resourceOverflow?: number;
  inventoryFull?: number;
  mapFailure?: number;
  dungeonFailure?: number;
  pendingSettlements?: number;
  dropDeviation?: number;
  economicAnomaly?: number;
};

export type MetricsAlert = {
  code: keyof MetricsThresholds;
  observed: number;
  threshold: number;
};

export type MetricsCollectorOptions = {
  clock?: () => number;
  maxDurationSamples?: number;
};

/**
 * Optional durable telemetry sink. Implementations must be asynchronous;
 * GameService treats writes as best-effort and never waits for them during a
 * gameplay request. `toPrometheus` is used only by the metrics scrape path.
 */
export type MetricsSink = {
  record: (event: MetricsEvent) => Promise<void>;
  toPrometheus?: (at?: number) => Promise<string>;
};

const RESOURCE_IDS: ResourceId[] = ['spirit_stone', 'spirit_herb', 'spirit_ore', 'spirit_wood', 'pill', 'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core'];
const SETTLEMENT_METRICS: SettlementMetric[] = ['success', 'rejected', 'duplicate', 'stale'];
const ACTIVITY_METRICS: ActivityMetric[] = ['success', 'failure', 'gate', 'cooldown'];
const EQUIPMENT_GROWTH_METRICS: EquipmentGrowthMetric[] = ['reinforce', 'promote', 'awaken'];
const EVENT_TYPES: readonly MetricsEvent['type'][] = [
  'settlement_success', 'settlement_rejected', 'settlement_duplicate', 'settlement_stale',
  'map_success', 'map_failure', 'map_gate', 'map_cooldown',
  'dungeon_success', 'dungeon_failure', 'dungeon_gate', 'dungeon_cooldown',
  'inventory_full', 'resource_update', 'equipment_growth', 'settlement_pending',
  'drop_observation', 'economic_anomaly',
];

const emptyRecord = <T extends string>(keys: T[], value: number): Record<T, number> => Object.fromEntries(keys.map((key) => [key, value])) as Record<T, number>;
const emptyResources = (): Record<ResourceId, ResourceMetric> => Object.fromEntries(RESOURCE_IDS.map((id) => [id, { delta: 0, overflow: 0 }])) as Record<ResourceId, ResourceMetric>;
const prometheusLabel = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
const finiteNonNegative = (value: number | undefined, label: string): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number`);
  return value;
};
const eventTime = (value: MetricsEvent['at'], fallback: number): number => {
  if (value === undefined) return fallback;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError('event at must be a valid timestamp');
  return parsed;
};

export class MetricsCollector {
  private readonly clock: () => number;
  private readonly maxDurationSamples: number;
  private readonly settlements = emptyRecord(SETTLEMENT_METRICS, 0);
  private readonly map = emptyRecord(ACTIVITY_METRICS, 0);
  private readonly dungeon = emptyRecord(ACTIVITY_METRICS, 0);
  private readonly equipmentGrowth = emptyRecord(EQUIPMENT_GROWTH_METRICS, 0);
  private readonly resources = emptyResources();
  private inventoryFull = 0;
  private pendingSettlements = 0;
  private readonly drops: Record<string, DropMetric> = {};
  private readonly economicAnomalies: Record<string, number> = {};
  private readonly settlementDurations: number[] = [];
  private readonly pendingAges: number[] = [];

  constructor(options: MetricsCollectorOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.maxDurationSamples = Math.max(1, Math.floor(options.maxDurationSamples ?? 256));
  }

  record(event: MetricsEvent): void {
    if (!EVENT_TYPES.includes(event.type)) throw new TypeError('metrics event type is not supported');
    const at = eventTime(event.at, this.clock());
    if (!Number.isFinite(at)) throw new RangeError('event at must be finite');
    const [category, outcome] = event.type.split('_');

    // Validate the whole event before mutating any aggregate. Telemetry is
    // best-effort, but a malformed event must not leave a partially applied
    // counter/sample behind when the caller catches the validation error.
    const duration = event.type === 'settlement_success' ? finiteNonNegative(event.durationMs, 'durationMs') : undefined;
    const pendingAge = event.pendingAgeMs === undefined ? undefined : finiteNonNegative(event.pendingAgeMs, 'pendingAgeMs');
    let dropKey: string | undefined;
    let dropExpected = 0;
    let dropActual = 0;
    let anomalyKey: string | undefined;
    let anomalyValue = 0;
    if (event.type === 'equipment_growth' && (!event.growth || !EQUIPMENT_GROWTH_METRICS.includes(event.growth as EquipmentGrowthMetric))) {
      throw new TypeError('equipment_growth events require a supported growth value');
    }
    if (event.type === 'drop_observation') {
      if (!event.dropKey || event.dropKey.length > 128) throw new TypeError('drop_observation events require a bounded dropKey');
      dropKey = event.dropKey;
      dropExpected = finiteNonNegative(event.dropExpected, 'dropExpected');
      dropActual = finiteNonNegative(event.dropActual, 'dropActual');
    }
    if (event.type === 'economic_anomaly') {
      if (!event.anomalyKey || event.anomalyKey.length > 128) throw new TypeError('economic_anomaly events require a bounded anomalyKey');
      anomalyKey = event.anomalyKey;
      anomalyValue = finiteNonNegative(event.anomalyValue, 'anomalyValue');
    }
    const resourceSamples = RESOURCE_IDS.map((id) => {
      const delta = event.resourceDelta?.[id] ?? 0;
      const overflow = event.resourceOverflow?.[id] ?? 0;
      if (!Number.isFinite(delta) || !Number.isFinite(overflow) || overflow < 0) throw new RangeError(`invalid resource metrics for ${id}`);
      return { id, delta, overflow };
    });

    if (event.type === 'settlement_pending') this.pendingSettlements += 1;
    else if (category === 'settlement') this.settlements[outcome as SettlementMetric] += 1;
    else if (category === 'map') this.map[outcome as ActivityMetric] += 1;
    else if (category === 'dungeon') this.dungeon[outcome as ActivityMetric] += 1;
    else if (event.type === 'inventory_full') this.inventoryFull += 1;
    else if (event.type === 'equipment_growth') {
      this.equipmentGrowth[event.growth as EquipmentGrowthMetric] += 1;
    }
    else if (event.type === 'drop_observation' && dropKey) {
      const current = this.drops[dropKey] ?? { expected: 0, actual: 0, absoluteDeviation: 0 };
      current.expected += dropExpected;
      current.actual += dropActual;
      current.absoluteDeviation += Math.abs(dropActual - dropExpected);
      this.drops[dropKey] = current;
    }
    else if (event.type === 'economic_anomaly' && anomalyKey) {
      this.economicAnomalies[anomalyKey] = (this.economicAnomalies[anomalyKey] ?? 0) + anomalyValue;
    }

    if (duration !== undefined) this.appendSample(this.settlementDurations, duration);
    if (pendingAge !== undefined) this.appendSample(this.pendingAges, pendingAge);
    for (const { id, delta, overflow } of resourceSamples) {
      this.resources[id].delta += delta;
      this.resources[id].overflow += overflow;
    }
  }

  snapshot(at = this.clock()): MetricsSnapshot {
    return {
      generatedAt: new Date(at).toISOString(),
      settlements: { ...this.settlements },
      map: { ...this.map },
      dungeon: { ...this.dungeon },
      inventoryFull: this.inventoryFull,
      equipmentGrowth: { ...this.equipmentGrowth },
      settlementDuration: this.aggregate(this.settlementDurations),
      pendingAge: this.aggregate(this.pendingAges),
      resources: Object.fromEntries(RESOURCE_IDS.map((id) => [id, { ...this.resources[id] }])) as Record<ResourceId, ResourceMetric>,
      pendingSettlements: this.pendingSettlements,
      drops: Object.fromEntries(Object.entries(this.drops).map(([key, metric]) => [key, { ...metric }])) as Record<string, DropMetric>,
      economicAnomalies: { ...this.economicAnomalies },
    };
  }

  toPrometheus(at = this.clock()): string {
    return metricsSnapshotToPrometheus(this.snapshot(at));
  }

  
  queryAlerts(thresholds: MetricsThresholds, at = this.clock()): MetricsAlert[] {
    const snapshot = this.snapshot(at);
    const observed: Record<keyof MetricsThresholds, number> = {
      settlementRejected: snapshot.settlements.rejected,
      settlementDuplicate: snapshot.settlements.duplicate,
      settlementStale: snapshot.settlements.stale,
      settlementDurationMaxMs: snapshot.settlementDuration.maxMs,
      pendingAgeMaxMs: snapshot.pendingAge.maxMs,
      resourceOverflow: Object.values(snapshot.resources).reduce((sum, metric) => sum + metric.overflow, 0),
      inventoryFull: snapshot.inventoryFull,
      mapFailure: snapshot.map.failure,
      dungeonFailure: snapshot.dungeon.failure,
      pendingSettlements: snapshot.pendingSettlements,
      dropDeviation: Object.values(snapshot.drops).reduce((sum, metric) => sum + metric.absoluteDeviation, 0),
      economicAnomaly: Object.values(snapshot.economicAnomalies).reduce((sum, value) => sum + value, 0),
    };
    return (Object.keys(thresholds) as (keyof MetricsThresholds)[]).flatMap((code) => {
      const threshold = thresholds[code];
      if (threshold === undefined) return [];
      finiteNonNegative(threshold, `threshold ${code}`);
      return observed[code] >= threshold ? [{ code, observed: observed[code], threshold }] : [];
    });
  }

  private appendSample(samples: number[], value: number): void {
    if (samples.length === this.maxDurationSamples) samples.shift();
    samples.push(value);
  }

  private aggregate(samples: number[]): MetricAggregate {
    const count = samples.length;
    const totalMs = samples.reduce((sum, value) => sum + value, 0);
    return { count, totalMs, maxMs: count ? Math.max(...samples) : 0, averageMs: count ? totalMs / count : 0 };
  }
}

/** Serialize any snapshot, including one loaded from a durable backend. */
export const metricsSnapshotToPrometheus = (snapshot: MetricsSnapshot): string => {
    const lines = [
      '# HELP dongtian_settlements_total Committed and rejected settlement outcomes.',
      '# TYPE dongtian_settlements_total counter',
      ...SETTLEMENT_METRICS.map((outcome) => `dongtian_settlements_total{outcome="${outcome}"} ${snapshot.settlements[outcome]}`),
      '# HELP dongtian_activity_total Map and dungeon activity outcomes.',
      '# TYPE dongtian_activity_total counter',
      ...ACTIVITY_METRICS.flatMap((outcome) => [
        `dongtian_activity_total{activity="map",outcome="${outcome}"} ${snapshot.map[outcome]}`,
        `dongtian_activity_total{activity="dungeon",outcome="${outcome}"} ${snapshot.dungeon[outcome]}`,
      ]),
      '# HELP dongtian_inventory_full_total Inventory capacity rejections.',
      '# TYPE dongtian_inventory_full_total counter',
      `dongtian_inventory_full_total ${snapshot.inventoryFull}`,
      '# HELP dongtian_settlement_duration_ms Settlement duration samples.',
      '# TYPE dongtian_settlement_duration_ms gauge',
      `dongtian_settlement_duration_ms{stat="average"} ${snapshot.settlementDuration.averageMs}`,
      `dongtian_settlement_duration_ms{stat="max"} ${snapshot.settlementDuration.maxMs}`,
      `dongtian_settlement_duration_ms{stat="count"} ${snapshot.settlementDuration.count}`,
      '# HELP dongtian_pending_age_ms Pending settlement age samples.',
      '# TYPE dongtian_pending_age_ms gauge',
      `dongtian_pending_age_ms{stat="average"} ${snapshot.pendingAge.averageMs}`,
      `dongtian_pending_age_ms{stat="max"} ${snapshot.pendingAge.maxMs}`,
      `dongtian_pending_age_ms{stat="count"} ${snapshot.pendingAge.count}`,
      '# HELP dongtian_resource_delta_total Resource deltas and capacity overflow.',
      '# TYPE dongtian_resource_delta_total counter',
      ...RESOURCE_IDS.flatMap((resource) => [
        `dongtian_resource_delta_total{resource="${resource}"} ${snapshot.resources[resource].delta}`,
        `dongtian_resource_overflow_total{resource="${resource}"} ${snapshot.resources[resource].overflow}`,
      ]),
      '# HELP dongtian_pending_settlements_total Durable settlement reservations observed.',
      '# TYPE dongtian_pending_settlements_total counter',
      `dongtian_pending_settlements_total ${snapshot.pendingSettlements}`,
      '# HELP dongtian_drop_deviation_total Absolute expected versus actual drop deviation.',
      '# TYPE dongtian_drop_deviation_total gauge',
      ...Object.entries(snapshot.drops).map(([dropKey, metric]) => `dongtian_drop_deviation_total{drop_key="${prometheusLabel(dropKey)}"} ${metric.absoluteDeviation}`),
      '# HELP dongtian_economic_anomaly_total Economic anomaly observations.',
      '# TYPE dongtian_economic_anomaly_total counter',
      ...Object.entries(snapshot.economicAnomalies).map(([anomalyKey, value]) => `dongtian_economic_anomaly_total{anomaly_key="${prometheusLabel(anomalyKey)}"} ${value}`),
    ];
    return `${lines.join('\n')}\n`;
};
