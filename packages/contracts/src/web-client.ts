import type { OpenApiDocument } from './generated/openapi.js';

export type AuthAccountType = 'ANONYMOUS' | 'REGISTERED';
export type AuthAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AuthAnonymousSession {
  readonly account_id: string;
  readonly character_id: string;
  readonly account_type: AuthAccountType;
  readonly csrf_token: string;
  readonly session_expires_at: string;
}

export interface AuthActiveSession {
  readonly authenticated: true;
  readonly account_id: string;
  readonly character_id: string;
  readonly account_type: AuthAccountType;
  readonly account_status: AuthAccountStatus;
  readonly csrf_token: string;
  readonly session_expires_at: string;
}

export interface AuthAnonymousSnapshot {
  readonly authenticated: false;
}

export type AuthSession = AuthAnonymousSnapshot | AuthActiveSession;

export interface AuthLogout {
  readonly logged_out: true;
}

export interface Manifest {
  readonly config_version: string;
  readonly schema_version: number;
  readonly formula_version: number;
  readonly created_at: string;
  readonly min_client_version: string;
  readonly content_hash: string;
  readonly previous_version: string | null;
}

export interface ContentCharacterSummary {
  readonly character_id: string;
  readonly name: string;
  readonly realm_stage_id: string;
}

export interface ContentUnlockState {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly usable: boolean;
  readonly optimized_ui: boolean;
  readonly reason_key: string | null;
  readonly reason: string;
  readonly blockers: ReadonlyArray<Record<string, unknown>>;
}

export interface ContentRoute {
  readonly route_type: 'ACTION' | 'RECIPE';
  readonly target_id: string;
  readonly name_key: string;
  readonly description_key: string | null;
  readonly source_note: string;
}

export interface ContentItemQuantity {
  readonly item_id: string;
  readonly quantity: string;
  readonly source_routes: ReadonlyArray<ContentRoute>;
  readonly usage_routes: ReadonlyArray<ContentRoute>;
  readonly available_quantity?: number;
  readonly reserved_quantity?: number;
  readonly quantity_owned?: number;
  readonly missing_quantity?: number;
}

export interface ActionCatalogEntry {
  readonly action_id: string;
  readonly name_key: string;
  readonly description_key: string | null;
  readonly skill_id: string | null;
  readonly enabled: boolean;
  readonly unlocked: boolean;
  readonly unlock_state: ContentUnlockState;
  readonly queue_action_id: string;
  readonly can_add_to_queue: boolean;
  readonly base_duration_us: string;
  readonly skill_xp: string;
  readonly cultivation_xp: string;
  readonly allowed_queue_modes: ReadonlyArray<string>;
  readonly required_tool_tag: string | null;
  readonly modifier_tags: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly inputs: ReadonlyArray<ContentItemQuantity>;
  readonly outputs: ReadonlyArray<ContentItemQuantity>;
}

export interface RecipeCatalogEntry {
  readonly recipe_id: string;
  readonly action_id: string;
  readonly name_key: string;
  readonly description_key: string | null;
  readonly craft_skill_id: string;
  readonly result_item_id: string;
  readonly result_quantity: string;
  readonly required_level: number;
  readonly required_facility_id: string | null;
  readonly enabled: boolean;
  readonly unlocked: boolean;
  readonly unlock_state: ContentUnlockState;
  readonly queue_action_id: string;
  readonly can_add_to_queue: boolean;
  readonly base_duration_us: string;
  readonly skill_xp: string;
  readonly tags: ReadonlyArray<string>;
  readonly ingredients: ReadonlyArray<ContentItemQuantity>;
  readonly result_item: ContentItemQuantity;
}

export interface ContentActionsResponse {
  readonly character: ContentCharacterSummary;
  readonly actions: ReadonlyArray<ActionCatalogEntry>;
  readonly calculation_as_of: string;
  readonly config_version: string;
}

export interface ContentRecipesResponse {
  readonly character: ContentCharacterSummary;
  readonly recipes: ReadonlyArray<RecipeCatalogEntry>;
  readonly calculation_as_of: string;
  readonly config_version: string;
}

export interface SkillToolAssignmentComparison {
  readonly preferred_equipment_instance_id: string;
  readonly throughput_delta_per_hour: string;
  readonly cycles_delta_per_hour: string;
}

export interface SkillToolAssignmentToolOption {
  readonly equipment_instance_id: string;
  readonly item_id: string;
  readonly item_name_key: string;
  readonly source_note: string;
  readonly required_realm: string;
  readonly required_tags: ReadonlyArray<string>;
  readonly tool_tag: string;
  readonly speed_multiplier: string;
  readonly efficiency_multiplier: string;
  readonly cycles_per_hour: string;
  readonly effective_throughput_per_hour: string;
  readonly source_routes: ReadonlyArray<ContentRoute>;
  readonly usage_routes: ReadonlyArray<ContentRoute>;
  readonly comparison: SkillToolAssignmentComparison | null;
}

export interface SkillToolAssignmentView {
  readonly skill_id: string;
  readonly current: SkillToolAssignmentToolOption | null;
  readonly options: ReadonlyArray<SkillToolAssignmentToolOption>;
}

export interface SkillToolAssignmentsSaveEntry {
  readonly skill_id: string;
  readonly equipment_instance_id: string | null;
}

export interface SkillToolAssignmentsSaveRequest {
  readonly expected_state_version: number | string;
  readonly assignments: ReadonlyArray<SkillToolAssignmentsSaveEntry>;
}

export interface SkillToolAssignmentsResponse {
  readonly character_id: string;
  readonly state_version: number;
  readonly config_version: string;
  readonly as_of: string;
  readonly effective_next_cycle?: boolean;
  readonly assignments: ReadonlyArray<SkillToolAssignmentView>;
}

export interface SkillToolAssignmentsEnvelope {
  readonly data: SkillToolAssignmentsResponse;
  readonly meta: ApiEnvelope<unknown>['meta'];
}

export interface CharacterProgression {
  readonly character: {
    readonly character_id: string;
    readonly name: string;
    readonly state_version: number;
    readonly active_config_version: string;
  };
  readonly cultivation: {
    readonly xp: string;
    readonly realm_stage_id: string;
    readonly stage_start_xp: string;
    readonly stage_required_xp: string;
    readonly stage_progress_xp: string;
    readonly remaining_xp: string;
    readonly progress_ratio: string;
  };
  readonly skills: ReadonlyArray<SkillProgression>;
  readonly feature_permissions: ReadonlyArray<FeaturePermission>;
  readonly calculation_as_of: string;
  readonly config_version: string;
}

export type BreakthroughAssetType = 'CULTIVATION_XP' | 'ITEM' | 'CURRENCY';
export type BreakthroughRequirementStatus = 'SATISFIED' | 'MISSING';
export type BreakthroughRunStatus = 'READY' | 'TRIAL_ACTIVE' | 'TRIAL_WAITING_CHOICE' | 'COMPLETED' | 'FAILED_RECOVERABLE' | 'ABANDONED';
export type BreakthroughRouteRisk = 'SAFE' | 'HIGH_RISK';
export interface BreakthroughRequirementPreview { readonly asset_type: BreakthroughAssetType; readonly asset_id: string; readonly current: string; readonly total: string; readonly reserved: string; readonly available: string; readonly required: string; readonly status: BreakthroughRequirementStatus; readonly shortfall: string; readonly source_route_id: string; readonly estimated_time_seconds: string | null; }
export interface BreakthroughPreview { readonly breakthrough_config_id: string; readonly target_realm_id: string; readonly config_version: string; readonly formula_version: number; readonly success_rate: string; readonly all_satisfied: boolean; readonly requirements: ReadonlyArray<BreakthroughRequirementPreview>; readonly unlock_bundle_id: string; }
export interface BreakthroughPreviewResponse { readonly character: { readonly character_id: string; readonly state_version: number; readonly active_config_version: string }; readonly breakthrough: BreakthroughPreview; readonly config_version: string; readonly active_run?: BreakthroughRun | null; }
export interface BreakthroughStartRequest { readonly expected_state_version: number | string; readonly config_version: string; }
export interface BreakthroughChoiceRequest { readonly choice_id: string; readonly expected_run_version: number | string; }
export interface BreakthroughReservedAsset { readonly asset_type: 'ITEM' | 'CURRENCY'; readonly asset_id: string; readonly quantity: string; }
export interface BreakthroughFinalizeResult { readonly breakthrough_run_id: string; readonly breakthrough_config_id: string; readonly success_rate: string; readonly unlocked_realm_id: string; readonly unlock_bundle_id: string; readonly queue_slots: number; readonly medicine_slots: number; readonly reserved_assets: ReadonlyArray<BreakthroughReservedAsset>; }
export interface BreakthroughRun { readonly breakthrough_run_id: string; readonly breakthrough_config_id: string; readonly config_version: string; readonly formula_version: number; readonly status: BreakthroughRunStatus; readonly run_version: number; readonly current_node_id: string; readonly created_at: string; readonly trial_deadline_at: string; readonly expires_at: string; readonly selected_choice_id: string | null; readonly selected_route_id: string | null; readonly selected_route_risk: BreakthroughRouteRisk | null; readonly selected_at: string | null; readonly finalized_at: string | null; readonly abandoned_at: string | null; readonly released_at: string | null; readonly reservation_snapshot: ReadonlyArray<BreakthroughReservedAsset>; readonly preview_snapshot: BreakthroughPreview; readonly result: BreakthroughFinalizeResult | null; }
export interface BreakthroughRunResponse { readonly character: { readonly character_id: string; readonly state_version: number; readonly active_config_version: string }; readonly config_version: string; readonly run: BreakthroughRun; }

export interface SkillProgression {
  readonly skill_id: string;
  readonly level: number;
  readonly xp: string;
  readonly xp_to_next: string;
  readonly remaining_xp: string;
  readonly next_level: number | null;
  readonly speed_modifier: string;
  readonly efficiency_modifier: string;
  readonly stage_node: boolean;
  readonly realm_required: string;
  readonly attack_bonus_per_level?: string | null;
  readonly character_state_version: number;
}

export interface FeaturePermission {
  readonly feature_id: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly usable: boolean;
  readonly optimized_ui: boolean;
  readonly locked_reason_key: string | null;
}

export interface EquipmentInstance {
  readonly instance_id: string;
  readonly item_id: string;
  readonly temper_level: number;
  readonly bound: boolean;
  readonly created_config_version: string;
}

export interface TemperingEquipmentSnapshot {
  readonly instance_id: string;
  readonly item_id: string;
  readonly temper_level: number;
  readonly bound: boolean;
  readonly created_config_version: string;
}

export interface TemperingCostSnapshot {
  readonly tempering_stone_cost: string;
  readonly spirit_stone_cost: string;
  readonly same_equipment_cost: string;
  readonly protection_material_cost_requested: string;
  readonly protection_material_cost_spent: string;
}

export interface TemperingRandomAudit {
  readonly namespace: string;
  readonly attempt_key: string;
  readonly seed_hex: string;
  readonly roll: string;
  readonly success_probability: string;
  readonly formula_version: number;
}

export interface TemperingAttemptRequest {
  readonly attempt_id: string;
  readonly expected_state_version: number | string;
  readonly target_level: number;
  readonly use_protection_material: boolean;
  readonly config_version: string;
}

export interface TemperingAttemptResponse {
  readonly character_id: string;
  readonly equipment_instance_id: string;
  readonly attempt_id: string;
  readonly from_level: number;
  readonly target_level: number;
  readonly level_before: number;
  readonly level_after: number;
  readonly status: 'APPLIED' | 'REJECTED';
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  readonly success: boolean;
  readonly success_probability: string;
  readonly attribute_increase: string;
  readonly random_audit: TemperingRandomAudit | null;
  readonly cost_snapshot: TemperingCostSnapshot;
  readonly equipment: TemperingEquipmentSnapshot;
  readonly asset_transaction_id: string;
  readonly temper_audit_id: string;
  readonly state_version: number;
  readonly config_version: string;
}

export interface CaveCostItem {
  readonly itemId: string;
  readonly quantity: string;
}

export interface CaveModifierSnapshot {
  readonly stat: string;
  readonly operation: 'ADD' | 'MULTIPLY';
  readonly value: string;
}

export interface CaveLevelRule {
  readonly level: number;
  readonly required_realm_group: 'MORTAL' | 'QI' | 'FOUNDATION';
  readonly spirit_stone_cost: string;
  readonly material_costs: ReadonlyArray<CaveCostItem>;
  readonly build_duration_us: string;
  readonly modifier: CaveModifierSnapshot;
  readonly scope: 'MVP' | 'MVP_ENDGAME';
}

export interface CaveBuildTaskCostSnapshot {
  readonly facility_config_id: string;
  readonly facility_kind: 'JULING_ROOM' | 'ALCHEMY_ROOM' | 'FORGING_ROOM';
  readonly name_key: string;
  readonly description_key: string;
  readonly level: number;
  readonly required_realm_group: 'MORTAL' | 'QI' | 'FOUNDATION';
  readonly spirit_stone_cost: string;
  readonly material_costs: ReadonlyArray<CaveCostItem>;
  readonly build_duration_us: string;
  readonly modifier: CaveModifierSnapshot;
  readonly scope: 'MVP' | 'MVP_ENDGAME';
}

export interface CaveBuildTask {
  readonly build_task_id: string;
  readonly facility_config_id: string;
  readonly from_level: number;
  readonly target_level: number;
  readonly started_at: string;
  readonly projected_completion_at: string;
  readonly completed_at: string | null;
  readonly status: 'RUNNING' | 'COMPLETED' | string;
  readonly cost_snapshot: CaveBuildTaskCostSnapshot;
  readonly completion_reached: boolean;
  readonly completion_boundary: {
    readonly currentCycleApplies: boolean;
    readonly nextCycleApplies: boolean;
  };
}

export interface CaveFacility {
  readonly facility_config_id: string;
  readonly facility_kind: 'JULING_ROOM' | 'ALCHEMY_ROOM' | 'FORGING_ROOM';
  readonly name_key: string;
  readonly description_key: string;
  readonly level: number;
  readonly current_modifier: CaveModifierSnapshot | null;
  readonly next_level_rule: CaveLevelRule | null;
  readonly build_task: CaveBuildTask | null;
}

export interface CaveCharacter {
  readonly character_id: string;
  readonly state_version: number;
  readonly active_config_version: string;
}

export interface CaveResponse {
  readonly character: CaveCharacter;
  readonly cave: {
    readonly as_of: string;
    readonly config_version: string;
    readonly facilities: ReadonlyArray<CaveFacility>;
  };
}

export interface CaveBuildRequest {
  readonly facility_id: string;
  readonly target_level: number;
  readonly expected_state_version: number | string;
  readonly config_version: string;
}

export interface InventoryAsset {
  readonly asset_type: 'ITEM' | 'CURRENCY';
  readonly asset_id: string;
  readonly category?: string;
  readonly quantity: number | string;
  readonly reserved_quantity: number | string;
  readonly available_quantity: number | string;
  readonly source_routes?: ReadonlyArray<ContentRoute>;
  readonly usage_routes?: ReadonlyArray<ContentRoute>;
}

export interface InventorySnapshot {
  readonly items: ReadonlyArray<InventoryAsset>;
  readonly currencies: ReadonlyArray<InventoryAsset>;
  readonly equipment_instances: ReadonlyArray<EquipmentInstance>;
  readonly total_count: number;
}

export type EquipmentSlot = 'WEAPON' | 'ARMOR' | 'ACCESSORY';

export interface LoadoutConsumable {
  readonly item_id: string;
  readonly quantity: string;
}

export interface LoadoutPreset {
  readonly character_id: string;
  readonly preset_id: string;
  readonly name: string;
  readonly active: boolean;
  readonly complete: boolean;
  readonly effective_next_cycle?: boolean;
  readonly state_version: number;
  readonly weapon_instance_id: string | null;
  readonly armor_instance_id: string | null;
  readonly accessory_instance_id: string | null;
  readonly combat_consumables: ReadonlyArray<LoadoutConsumable>;
  readonly strategy_id: string;
  readonly version: string;
}

export interface LoadoutPresetSaveRequest {
  readonly expected_state_version: number | string;
  readonly name: string;
  readonly weapon_instance_id: string | null;
  readonly armor_instance_id: string | null;
  readonly accessory_instance_id: string | null;
  readonly combat_consumables: ReadonlyArray<LoadoutConsumable>;
  readonly strategy_id: string;
}

export interface DungeonOpportunityCharacter {
  readonly character_id: string;
  readonly state_version: number;
  readonly active_config_version: string;
  readonly active_loadout_preset_id: string | null;
}

export interface DungeonOpportunityDetails {
  readonly current_opportunities: number;
  readonly opportunity_cap: number;
  readonly recovery_anchor_at: string;
  readonly next_recovery_at: string | null;
  readonly recovery_interval_seconds: number;
  readonly is_capped: boolean;
}

export interface DungeonTeachingGrantDetails {
  readonly source_tutorial_id: string;
  readonly claimed_at: string | null;
  readonly available: boolean;
  readonly applied_quantity: number;
}

export interface DungeonOpportunityResponse {
  readonly character: DungeonOpportunityCharacter;
  readonly opportunity: DungeonOpportunityDetails;
  readonly teaching_grant: DungeonTeachingGrantDetails;
  readonly calculation_as_of: string;
  readonly config_version: string;
}

export interface DungeonRunCreateRequest {
  readonly dungeon_id: string;
  readonly loadout_preset_id: string;
  readonly strategy_preset_id: string;
  readonly initial_route_id: string;
  readonly expected_state_version: number | string;
  readonly config_version: string;
}

export interface DungeonPreviewRequest {
  readonly character_id: string;
  readonly loadout_preset_id: string;
  readonly strategy_preset_id: string;
  readonly initial_route_id: string;
}

export interface DungeonChoiceRequest {
  readonly choice_id: string;
  readonly expected_run_version: number | string;
}

export interface DungeonPreviewChoice extends Record<string, unknown> {
  readonly choice_id?: string;
  readonly route_id?: string;
  readonly risk?: string;
  readonly label?: string;
  readonly label_key?: string;
  readonly node_id?: string;
  readonly success_rate?: string;
  readonly estimated_success_rate?: string;
}

export interface DungeonPreviewEntry extends Record<string, unknown> {
  readonly item_id?: string;
  readonly quantity?: string | number;
  readonly label?: string;
  readonly label_key?: string;
}

export interface DungeonPreviewResponse {
  readonly character: DungeonOpportunityCharacter;
  readonly dungeon: {
    readonly dungeon_id: string;
    readonly recommended_power: string;
    readonly base_success_rate: string;
    readonly estimated_success_rate: string;
    readonly choice_timeout_seconds: number;
    readonly opportunity_cost: number;
    readonly entry_items: ReadonlyArray<DungeonPreviewEntry>;
    readonly choices: ReadonlyArray<DungeonPreviewChoice>;
    readonly core_rewards: ReadonlyArray<string>;
  };
  readonly config_version: string;
  readonly calculation_as_of: string;
}

export interface DungeonRunDetails {
  readonly run_id: string;
  readonly dungeon_id: string;
  readonly status: string;
  readonly current_node_id: string;
  readonly phase: string;
  readonly outcome: string;
  readonly revision: number;
  readonly initial_route_id: string;
  readonly loadout_preset_id: string | null;
  readonly strategy_preset_id: string | null;
  readonly opportunity_cost: number;
  readonly config_version: string;
  readonly created_at: string;
  readonly choice_deadline_at: string;
  readonly selected_choice_id: string | null;
  readonly selected_route_id: string | null;
  readonly selected_route_risk: string | null;
  readonly selected_at: string | null;
  readonly combat_resolved_at: string | null;
  readonly finalized_at: string | null;
  readonly run_state: Record<string, unknown>;
}

export interface DungeonRunResponse {
  readonly character: DungeonOpportunityCharacter;
  readonly opportunity: DungeonOpportunityDetails;
  readonly teaching_grant: DungeonTeachingGrantDetails;
  readonly calculation_as_of: string;
  readonly config_version: string;
  readonly run: DungeonRunDetails;
}

export type QueueMode = 'COUNT' | 'DURATION' | 'UNTIL_INVENTORY' | 'INFINITE';
export type QueueBlockedPolicy = 'SKIP' | 'FALLBACK';
export type QueueEntryStatus = 'QUEUED' | 'RUNNING' | 'BLOCKED' | 'DONE' | 'DONE_INCOMPLETE' | 'DONE_CONDITION_MET' | 'CANCELLED';

export interface QueuePlanEntry {
  readonly client_entry_id: string;
  readonly action_id: string;
  readonly mode: QueueMode;
  readonly target_value?: number | string;
  readonly condition_item_id?: string;
  readonly condition_operator?: string;
  readonly on_blocked: QueueBlockedPolicy;
}

export interface QueuePlanFallback {
  readonly action_id: string;
  readonly mode: Extract<QueueMode, 'INFINITE'>;
}

export interface QueuePlanRequest {
  readonly expected_queue_version: number | string;
  readonly entries: ReadonlyArray<QueuePlanEntry>;
  readonly fallback: QueuePlanFallback;
}

export interface QueueVersionRequest {
  readonly expected_queue_version: number | string;
}

export interface QueueEntry {
  readonly entry_id: string;
  readonly client_entry_id: string | null;
  readonly position: number;
  readonly action_id: string;
  readonly mode: QueueMode;
  readonly target_value: string | null;
  readonly condition_item_id: string | null;
  readonly condition_operator: string | null;
  readonly on_blocked: QueueBlockedPolicy;
  readonly status: QueueEntryStatus;
  readonly completed_cycles: string;
  readonly progress_time_us: string;
  readonly snapshot_config_version: string | null;
}

export interface Queue {
  readonly queue_version: number | string;
  readonly paused: boolean;
  readonly pending_replace_after_cycle: boolean;
  readonly fallback: QueuePlanFallback;
  readonly current: QueueEntry | null;
  readonly entries: ReadonlyArray<QueueEntry>;
  readonly as_of: string;
}

export interface QueuePreviewEntry extends Record<string, unknown> {
  readonly client_entry_id?: string;
  readonly action_id?: string;
  readonly mode?: QueueMode;
  readonly target_value?: number | string | null;
  readonly blocked_reason?: string | null;
}

export interface QueuePreviewWarning extends Record<string, unknown> {
  readonly message_key?: string;
  readonly message?: string;
  readonly blocked_reason?: string | null;
}

export interface QueuePreview {
  readonly queue_version: number | string;
  readonly expected_queue_version: number | string;
  readonly entries: ReadonlyArray<QueuePreviewEntry>;
  readonly fallback: Record<string, unknown>;
  readonly total_duration_us: string | null;
  readonly warnings: ReadonlyArray<QueuePreviewWarning>;
  readonly calculation_as_of: string;
  readonly config_version: string;
}

export interface QueueMutation {
  readonly queue_version: number | string;
  readonly effective_at: string;
  readonly pending_replace_after_cycle: boolean;
  readonly paused: boolean;
  readonly queue: Queue;
}

export type SettlementJson = string | number | boolean | null | readonly SettlementJson[] | { readonly [key: string]: SettlementJson };

export interface SettlementRewardItem {
  readonly item_id: string;
  readonly quantity: string;
}

export interface SettlementRewards {
  readonly cultivation_xp: string;
  readonly skill_xp: string;
  readonly items: ReadonlyArray<SettlementRewardItem>;
}

export interface SettlementTimelineEntry {
  readonly segment_index: number;
  readonly queue_entry_id: string | null;
  readonly action_config_id: string;
  readonly from_at: string;
  readonly to_at: string;
  readonly completed_cycles: string;
  readonly inputs: SettlementJson;
  readonly outputs: SettlementJson;
  readonly xp_changes: SettlementJson;
  readonly transition_reason: string | null;
  readonly snapshot: SettlementJson;
}

export interface SettlementLedgerEntry {
  readonly entry_id: string;
  readonly transaction_id: string;
  readonly asset_type: string;
  readonly asset_id: string;
  readonly delta: string;
  readonly balance_after: string;
  readonly reason_code: string;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly config_version: string;
  readonly created_at: string;
}

export interface LatestSettlementSummary {
  readonly settlement_id: string;
  readonly character_id: string;
  readonly as_of: string;
  readonly from_at: string;
  readonly requested_until: string;
  readonly effective_until: string;
  readonly effective_time_us: string;
  readonly capped_time_us: string;
  readonly continuation_required: boolean;
  readonly status: string;
  readonly summary: SettlementJson;
  readonly rewards: SettlementRewards;
  readonly timeline: ReadonlyArray<SettlementTimelineEntry>;
  readonly ledger_entries: ReadonlyArray<SettlementLedgerEntry>;
}

export interface LatestSettlementResponse {
  readonly settlement: LatestSettlementSummary | null;
}

export interface ApiEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly request_id: string;
    readonly server_time: string;
    readonly state_version?: number;
    readonly config_version?: string;
  };
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ApiClient {
  readonly getCsrfToken: () => string | null;
  readonly setCsrfToken: (csrfToken: string | null) => void;
  readonly anonymousSession: () => Promise<AuthAnonymousSession>;
  readonly getSession: () => Promise<AuthSession>;
  readonly logout: () => Promise<AuthLogout>;
  readonly getManifest: () => Promise<Manifest>;
  readonly getProgression: (characterId: string) => Promise<CharacterProgression>;
  readonly getNextBreakthrough: (characterId: string) => Promise<BreakthroughPreviewResponse>;
  readonly previewBreakthrough: (characterId: string) => Promise<BreakthroughPreviewResponse>;
  readonly startBreakthrough: (characterId: string, request: BreakthroughStartRequest, idempotencyKey: string) => Promise<BreakthroughRunResponse>;
  readonly getBreakthroughRun: (runId: string) => Promise<BreakthroughRunResponse>;
  readonly chooseBreakthroughRoute: (runId: string, request: BreakthroughChoiceRequest, idempotencyKey: string) => Promise<BreakthroughRunResponse>;
  readonly finalizeBreakthroughRun: (runId: string, idempotencyKey: string) => Promise<BreakthroughRunResponse>;
  readonly abandonBreakthroughRun: (runId: string, idempotencyKey: string) => Promise<BreakthroughRunResponse>;
  readonly getInventory: (characterId: string, category?: string) => Promise<InventorySnapshot>;
  readonly getLoadoutPreset: (characterId: string, presetId: string) => Promise<LoadoutPreset>;
  readonly saveLoadoutPreset: (
    characterId: string,
    presetId: string,
    request: LoadoutPresetSaveRequest,
    idempotencyKey: string,
  ) => Promise<LoadoutPreset>;
  readonly equipLoadoutPreset: (
    characterId: string,
    presetId: string,
    idempotencyKey: string,
  ) => Promise<LoadoutPreset>;
  readonly temperEquipment: (
    characterId: string,
    instanceId: string,
    request: TemperingAttemptRequest,
    idempotencyKey: string,
  ) => Promise<TemperingAttemptResponse>;
  readonly getActions: () => Promise<ContentActionsResponse>;
  readonly getRecipes: () => Promise<ContentRecipesResponse>;
  readonly getSkillToolAssignments: (characterId: string) => Promise<SkillToolAssignmentsResponse>;
  readonly saveSkillToolAssignments: (
    characterId: string,
    request: SkillToolAssignmentsSaveRequest,
    idempotencyKey: string,
  ) => Promise<SkillToolAssignmentsResponse>;
  readonly getLatestSettlement: (characterId: string) => Promise<LatestSettlementResponse>;
  readonly getCave: (characterId: string) => Promise<CaveResponse>;
  readonly buildCaveFacility: (characterId: string, request: CaveBuildRequest, idempotencyKey: string) => Promise<CaveResponse>;
  readonly getDungeonOpportunities: (characterId: string) => Promise<DungeonOpportunityResponse>;
  readonly claimDungeonTeachingGrant: (characterId: string, idempotencyKey: string) => Promise<DungeonOpportunityResponse>;
  readonly previewDungeon: (dungeonId: string, request: DungeonPreviewRequest) => Promise<DungeonPreviewResponse>;
  readonly enterDungeonRun: (characterId: string, request: DungeonRunCreateRequest, idempotencyKey: string) => Promise<DungeonRunResponse>;
  readonly getDungeonRun: (characterId: string, runId: string) => Promise<DungeonRunResponse>;
  readonly getDungeonRunById: (runId: string) => Promise<DungeonRunResponse>;
  readonly chooseDungeonRun: (runId: string, request: DungeonChoiceRequest, idempotencyKey: string) => Promise<DungeonRunResponse>;
  readonly finalizeDungeonRun: (runId: string, idempotencyKey: string) => Promise<DungeonRunResponse>;
  readonly getQueue: (characterId: string) => Promise<Queue>;
  readonly previewQueue: (characterId: string, request: QueuePlanRequest) => Promise<QueuePreview>;
  readonly saveQueue: (characterId: string, request: QueuePlanRequest, idempotencyKey: string) => Promise<QueueMutation>;
  readonly pauseQueue: (characterId: string, request: QueueVersionRequest, idempotencyKey: string) => Promise<QueueMutation>;
  readonly resumeQueue: (characterId: string, request: QueueVersionRequest, idempotencyKey: string) => Promise<QueueMutation>;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly code: string | undefined;
  public readonly details: unknown | undefined;

  public constructor(message: string, options: { status: number; retryable: boolean; code?: string | undefined; details?: unknown }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.retryable = options.retryable;
    this.code = options.code;
    this.details = options.details;
  }
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
    return window.location.origin;
  }

  return 'http://127.0.0.1:3000';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeErrorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const error = body['error'];
    if (isRecord(error) && typeof error['message_key'] === 'string') {
      return error['message_key'];
    }
    if (typeof error === 'string') {
      return error;
    }
  }

  if (status === 503) {
    return 'error.maintenance';
  }

  if (status === 401) {
    return 'error.session_expired';
  }

  return `HTTP ${status}`;
}

function extractErrorDetails(body: unknown): { code: string | undefined; details: unknown | undefined } {
  if (!isRecord(body)) {
    return { code: undefined, details: undefined };
  }

  const error = body['error'];
  if (!isRecord(error)) {
    return { code: undefined, details: undefined };
  }

  return {
    code: typeof error['code'] === 'string' ? error['code'] : undefined,
    details: 'details' in error ? error['details'] : undefined,
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as unknown;
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

async function requestJson<TResponse>(
  baseUrl: string,
  fetchImpl: typeof fetch,
  csrfToken: string | null,
  path: string,
  init: RequestInit,
): Promise<TResponse> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');

  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const method = (init.method ?? 'GET').toUpperCase();
  if (csrfToken !== null && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.set('x-csrf-token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Network request failed.';
    throw new ApiClientError(message, { status: 0, retryable: true });
  }

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const { code, details } = extractErrorDetails(body);
    const errorOptions: { status: number; retryable: boolean; code?: string | undefined; details?: unknown } = {
      status: response.status,
      retryable: response.status >= 500 || response.status === 429,
    };

    if (code !== undefined) {
      errorOptions.code = code;
    }
    if (details !== undefined) {
      errorOptions.details = details;
    }

    throw new ApiClientError(normalizeErrorMessage(response.status, body), errorOptions);
  }

  return body as TResponse;
}

function encodeQuery(params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let csrfToken: string | null = null;

  return {
    getCsrfToken(): string | null {
      return csrfToken;
    },
    setCsrfToken(nextCsrfToken: string | null): void {
      csrfToken = nextCsrfToken;
    },
    async anonymousSession(): Promise<AuthAnonymousSession> {
      const response = await requestJson<ApiEnvelope<AuthAnonymousSession>>(baseUrl, fetchImpl, csrfToken, '/api/v1/auth/anonymous', {
        method: 'POST',
        body: '{}',
      });
      return response.data;
    },
    async getSession(): Promise<AuthSession> {
      const response = await requestJson<ApiEnvelope<AuthSession>>(baseUrl, fetchImpl, csrfToken, '/api/v1/auth/session', {
        method: 'GET',
      });
      return response.data;
    },
    async logout(): Promise<AuthLogout> {
      const response = await requestJson<ApiEnvelope<AuthLogout>>(baseUrl, fetchImpl, csrfToken, '/api/v1/auth/logout', {
        method: 'POST',
        body: '{}',
      });
      csrfToken = null;
      return response.data;
    },
    async getManifest(): Promise<Manifest> {
      const response = await requestJson<ApiEnvelope<Manifest>>(baseUrl, fetchImpl, csrfToken, '/api/v1/config/manifest', {
        method: 'GET',
      });
      return response.data;
    },
    async getProgression(characterId: string): Promise<CharacterProgression> {
      const response = await requestJson<ApiEnvelope<CharacterProgression>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/progression`, {
        method: 'GET',
      });
      return response.data;
    },
    async getNextBreakthrough(characterId: string): Promise<BreakthroughPreviewResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughPreviewResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/breakthroughs/next`, { method: 'GET' });
      return response.data;
    },
    async previewBreakthrough(characterId: string): Promise<BreakthroughPreviewResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughPreviewResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/breakthroughs/preview`, { method: 'POST', body: '{}' });
      return response.data;
    },
    async startBreakthrough(characterId: string, request: BreakthroughStartRequest, idempotencyKey: string): Promise<BreakthroughRunResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughRunResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/breakthroughs`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(request) });
      return response.data;
    },
    async getBreakthroughRun(runId: string): Promise<BreakthroughRunResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughRunResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/breakthrough-runs/${runId}`, { method: 'GET' });
      return response.data;
    },
    async chooseBreakthroughRoute(runId: string, request: BreakthroughChoiceRequest, idempotencyKey: string): Promise<BreakthroughRunResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughRunResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/breakthrough-runs/${runId}/choices`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(request) });
      return response.data;
    },
    async finalizeBreakthroughRun(runId: string, idempotencyKey: string): Promise<BreakthroughRunResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughRunResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/breakthrough-runs/${runId}/finalize`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: '{}' });
      return response.data;
    },
    async abandonBreakthroughRun(runId: string, idempotencyKey: string): Promise<BreakthroughRunResponse> {
      const response = await requestJson<ApiEnvelope<BreakthroughRunResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/breakthrough-runs/${runId}/abandon`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: '{}' });
      return response.data;
    },
    async getInventory(characterId: string, category?: string): Promise<InventorySnapshot> {
      const response = await requestJson<ApiEnvelope<InventorySnapshot>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/inventory${encodeQuery({ category })}`,
        {
          method: 'GET',
        },
      );
      return response.data;
    },
    async getLoadoutPreset(characterId: string, presetId: string): Promise<LoadoutPreset> {
      const response = await requestJson<ApiEnvelope<LoadoutPreset>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/loadouts/${presetId}`,
        {
          method: 'GET',
        },
      );
      return response.data;
    },
    async saveLoadoutPreset(
      characterId: string,
      presetId: string,
      request: LoadoutPresetSaveRequest,
      idempotencyKey: string,
    ): Promise<LoadoutPreset> {
      const response = await requestJson<ApiEnvelope<LoadoutPreset>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/loadouts/${presetId}`,
        {
          method: 'PUT',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async equipLoadoutPreset(characterId: string, presetId: string, idempotencyKey: string): Promise<LoadoutPreset> {
      const response = await requestJson<ApiEnvelope<LoadoutPreset>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/loadouts/${presetId}/equip`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
        },
      );
      return response.data;
    },
    async temperEquipment(
      characterId: string,
      instanceId: string,
      request: TemperingAttemptRequest,
      idempotencyKey: string,
    ): Promise<TemperingAttemptResponse> {
      const response = await requestJson<ApiEnvelope<TemperingAttemptResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/equipment/${instanceId}/temper`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async getActions(): Promise<ContentActionsResponse> {
      const response = await requestJson<ApiEnvelope<ContentActionsResponse>>(baseUrl, fetchImpl, csrfToken, '/api/v1/actions', {
        method: 'GET',
      });
      return response.data;
    },
    async getRecipes(): Promise<ContentRecipesResponse> {
      const response = await requestJson<ApiEnvelope<ContentRecipesResponse>>(baseUrl, fetchImpl, csrfToken, '/api/v1/recipes', {
        method: 'GET',
      });
      return response.data;
    },
    async getSkillToolAssignments(characterId: string): Promise<SkillToolAssignmentsResponse> {
      const response = await requestJson<SkillToolAssignmentsEnvelope>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/skill-tool-assignments`,
        {
          method: 'GET',
        },
      );
      return response.data;
    },
    async saveSkillToolAssignments(
      characterId: string,
      request: SkillToolAssignmentsSaveRequest,
      idempotencyKey: string,
    ): Promise<SkillToolAssignmentsResponse> {
      const response = await requestJson<SkillToolAssignmentsEnvelope>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/skill-tool-assignments`,
        {
          method: 'PUT',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async getLatestSettlement(characterId: string): Promise<LatestSettlementResponse> {
      const response = await requestJson<ApiEnvelope<LatestSettlementResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/settlements/latest`,
        { method: 'GET' },
      );
      return response.data;
    },
    async getCave(characterId: string): Promise<CaveResponse> {
      const response = await requestJson<ApiEnvelope<CaveResponse>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/cave`, {
        method: 'GET',
      });
      return response.data;
    },
    async buildCaveFacility(characterId: string, request: CaveBuildRequest, idempotencyKey: string): Promise<CaveResponse> {
      const response = await requestJson<ApiEnvelope<CaveResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/cave/builds`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async getDungeonOpportunities(characterId: string): Promise<DungeonOpportunityResponse> {
      const response = await requestJson<ApiEnvelope<DungeonOpportunityResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/dungeon-opportunities`,
        { method: 'GET' },
      );
      return response.data;
    },
    async claimDungeonTeachingGrant(characterId: string, idempotencyKey: string): Promise<DungeonOpportunityResponse> {
      const response = await requestJson<ApiEnvelope<DungeonOpportunityResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/dungeon-opportunities/teaching-grant`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: '{}',
        },
      );
      return response.data;
    },
    async previewDungeon(dungeonId: string, request: DungeonPreviewRequest): Promise<DungeonPreviewResponse> {
      const response = await requestJson<ApiEnvelope<DungeonPreviewResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/dungeons/${dungeonId}/preview`,
        {
          method: 'POST',
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async enterDungeonRun(characterId: string, request: DungeonRunCreateRequest, idempotencyKey: string): Promise<DungeonRunResponse> {
      const response = await requestJson<ApiEnvelope<DungeonRunResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/dungeon-runs`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async getDungeonRun(characterId: string, runId: string): Promise<DungeonRunResponse> {
      const response = await requestJson<ApiEnvelope<DungeonRunResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/dungeon-runs/${runId}`,
        { method: 'GET' },
      );
      return response.data;
    },
    async getDungeonRunById(runId: string): Promise<DungeonRunResponse> {
      const response = await requestJson<ApiEnvelope<DungeonRunResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/dungeon-runs/${runId}`,
        { method: 'GET' },
      );
      return response.data;
    },
    async chooseDungeonRun(runId: string, request: DungeonChoiceRequest, idempotencyKey: string): Promise<DungeonRunResponse> {
      const response = await requestJson<ApiEnvelope<DungeonRunResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/dungeon-runs/${runId}/choices`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async finalizeDungeonRun(runId: string, idempotencyKey: string): Promise<DungeonRunResponse> {
      const response = await requestJson<ApiEnvelope<DungeonRunResponse>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/dungeon-runs/${runId}/finalize`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: '{}',
        },
      );
      return response.data;
    },
    async getQueue(characterId: string): Promise<Queue> {
      const response = await requestJson<ApiEnvelope<Queue>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/queue`, {
        method: 'GET',
      });
      return response.data;
    },
    async previewQueue(characterId: string, request: QueuePlanRequest): Promise<QueuePreview> {
      const response = await requestJson<ApiEnvelope<QueuePreview>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/queue/preview`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return response.data;
    },
    async saveQueue(characterId: string, request: QueuePlanRequest, idempotencyKey: string): Promise<QueueMutation> {
      const response = await requestJson<ApiEnvelope<QueueMutation>>(baseUrl, fetchImpl, csrfToken, `/api/v1/characters/${characterId}/queue`, {
        method: 'PUT',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify(request),
      });
      return response.data;
    },
    async pauseQueue(characterId: string, request: QueueVersionRequest, idempotencyKey: string): Promise<QueueMutation> {
      const response = await requestJson<ApiEnvelope<QueueMutation>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/queue/pause`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
    async resumeQueue(characterId: string, request: QueueVersionRequest, idempotencyKey: string): Promise<QueueMutation> {
      const response = await requestJson<ApiEnvelope<QueueMutation>>(
        baseUrl,
        fetchImpl,
        csrfToken,
        `/api/v1/characters/${characterId}/queue/resume`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify(request),
        },
      );
      return response.data;
    },
  };
}

export type OpenApiDoc = OpenApiDocument;
