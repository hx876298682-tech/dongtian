export type Realm = 'qi_refining' | 'foundation_establishment';
export type ActivityStatus = 'idle' | 'fighting' | 'success' | 'cooldown';
export type PrimaryAction = 'training' | 'expedition';

export type Resources = {
  stones: number;
  wood: number;
  herbs: number;
  ore: number;
  pills: number;
  scrolls: number;
};

export type Equipment = {
  id: string;
  name: string;
  type: string;
  rarity: string;
  glyph: string;
  bonus: string;
  power: number;
};

export type Activity = {
  id: string;
  action: PrimaryAction;
  status: ActivityStatus;
  mapId?: string;
  claimable: boolean;
  cooldownRemaining: number;
  carrySeconds: number;
  seed?: number;
};

export type GameState = {
  revision: number;
  cultivation: number;
  realm: Realm;
  power: number;
  resources: Resources;
  activity: Activity;
  equipment: Equipment[];
  mapPityKills: Record<string, number>;
};

export type SettlementSummary = {
  ok: boolean;
  kind: 'claim_training' | 'expedition_start' | 'expedition_settle' | 'offline' | 'breakthrough' | 'rejected' | 'cooldown';
  message: string;
  activityStatus: ActivityStatus;
  resourceDelta: Resources;
  overflowResources: Resources;
  equipmentIds: string[];
};

export type EngineResult = {
  state: GameState;
  summary: SettlementSummary;
};

export type BreakthroughCheck = {
  ok: boolean;
  missing: string[];
};
