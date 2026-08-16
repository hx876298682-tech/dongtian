import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  CharacterProgressionRecord,
  CharacterRepository,
} from '@dongtian/database';
import {
  mapCultivationStage,
  mapSkillProgress,
  type SkillProgress,
} from '@dongtian/game-rules';

import { configRegistryToken } from '../config/config.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { computeFeaturePermissions } from '../content/content-visibility.js';
import { characterRepositoryToken } from './character.tokens.js';

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function stateVersionAsNumber(stateVersion: string): number {
  const parsed = Number(stateVersion);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

@Injectable()
export class CharacterService {
  public constructor(
    @Inject(characterRepositoryToken) private readonly repository: CharacterRepository,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getProgression(
    request: FastifyRequest,
    characterId: string,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const character = await this.repository.getProgression(characterId, accountId);
    if (!character) {
      throw notFound();
    }

    const stageProgress = mapCultivationStage(this.configRegistry.realms, character.cultivationXp);
    const stateVersion = stateVersionAsNumber(character.stateVersion);
    const skills = character.skills.map((skill) => this.mapSkill(character, skill.skillId, skill.xp));

    return {
      character: {
        character_id: character.characterId,
        name: character.name,
        state_version: stateVersion,
        active_config_version: character.activeConfigVersion,
      },
      cultivation: {
        xp: character.cultivationXp,
        realm_stage_id: stageProgress.realmStageId,
        stage_start_xp: stageProgress.stageStartXp,
        stage_required_xp: stageProgress.stageRequiredXp,
        stage_progress_xp: stageProgress.stageProgressXp,
        remaining_xp: stageProgress.remainingXp,
        progress_ratio: stageProgress.progressRatio,
      },
      skills,
      feature_permissions: computeFeaturePermissions(
        this.configRegistry,
        stageProgress.realmStageId,
        character.skills,
      ),
      calculation_as_of: new Date().toISOString(),
      config_version: this.configRegistry.manifest.config_version,
    };
  }

  private mapSkill(
    character: CharacterProgressionRecord,
    skillId: string,
    skillXp: string,
  ): Record<string, unknown> {
    const skill = this.configRegistry.getSkill(skillId);
    const progress: SkillProgress = mapSkillProgress(this.configRegistry.getSkillXpCurve(skillId), skillXp);
    return {
      skill_id: skill.id,
      level: progress.level,
      xp: progress.xp,
      xp_to_next: progress.xpToNext,
      remaining_xp: progress.remainingXp,
      next_level: progress.nextLevel,
      speed_modifier: progress.speedModifier,
      efficiency_modifier: progress.efficiencyModifier,
      stage_node: progress.stageNode,
      realm_required: skill.realm_required,
      character_state_version: stateVersionAsNumber(character.stateVersion),
    };
  }

}
