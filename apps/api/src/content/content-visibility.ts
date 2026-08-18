import type { ConfigRegistry, RealmConfig } from '@dongtian/config-schema';
import type { CharacterProgressionRecord } from '@dongtian/database';

export type FeaturePermission = {
  readonly feature_id: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly usable: boolean;
  readonly optimized_ui: boolean;
  readonly locked_reason_key: string | null;
};

function resolveStage(registry: ConfigRegistry, realmStageId: string): RealmConfig {
  return registry.getRealm(realmStageId);
}

export function computeFeaturePermissions(
  registry: ConfigRegistry,
  realmStageId: string,
  skillProgressions: CharacterProgressionRecord['skills'],
): readonly FeaturePermission[] {
  const currentStage = resolveStage(registry, realmStageId);
  const skillLevels = new Map(skillProgressions.map((skill) => [skill.skillId, skill.level]));

  return registry.features.map((feature) => {
    const enabled = feature.enabled;
    const visible =
      enabled &&
      currentStage.stage_order >= registry.getRealm(feature.visible_stage).stage_order;
    const skillReady =
      feature.required_skill_id === null ||
      (feature.required_skill_level !== null &&
        (skillLevels.get(feature.required_skill_id) ?? 0) >= feature.required_skill_level);
    const usable =
      visible &&
      currentStage.stage_order >= registry.getRealm(feature.usable_stage).stage_order &&
      skillReady;
    const optimized = usable && currentStage.stage_order >= registry.getRealm(feature.mastery_stage).stage_order;

    return {
      feature_id: feature.feature_id,
      enabled,
      visible,
      usable,
      optimized_ui: optimized,
      locked_reason_key: usable ? null : feature.locked_reason_key,
    };
  });
}
