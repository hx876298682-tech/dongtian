import { describe, expect, it } from 'vitest';

import { openApiDocument } from '../../packages/contracts/src/generated/openapi.js';

describe('generated OpenAPI contract', () => {
  it('contains the active M0 endpoints and shared error envelope', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.paths['/api/v1/health/live']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/health/ready']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/config/manifest']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/actions']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/recipes']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/auth/anonymous']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/auth/session']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/auth/logout']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/inventory']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/loadouts/{preset_id}']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/loadouts/{preset_id}/equip']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/settlements/latest']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/settlements/{settlement_id}']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/queue']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/queue/preview']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/queue/pause']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/queue/resume']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/breakthroughs/next']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/breakthroughs/preview']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/characters/{character_id}/breakthroughs']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/breakthrough-runs/{run_id}']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/breakthrough-runs/{run_id}/choices']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/breakthrough-runs/{run_id}/finalize']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/breakthrough-runs/{run_id}/abandon']).toBeDefined();
    const progressionPath = openApiDocument.paths['/api/v1/characters/{character_id}/progression'];
    expect(progressionPath).toBeDefined();
    expect(progressionPath?.get).toBeDefined();
    expect(progressionPath?.post).toBeUndefined();
    expect(openApiDocument.components?.schemas?.CharacterProgression).toBeDefined();
    expect(openApiDocument.components?.schemas?.InventorySnapshot).toBeDefined();
    expect(openApiDocument.components?.schemas?.LoadoutPresetEnvelope).toBeDefined();
    expect(openApiDocument.components?.schemas?.LatestSettlementSummary).toBeDefined();
    expect(openApiDocument.components?.schemas?.LatestSettlementResponse).toBeDefined();
    expect(openApiDocument.components?.schemas?.SuccessEnvelopeSettlementSummary).toBeDefined();
    expect(openApiDocument.components?.schemas?.BreakthroughPreview).toBeDefined();
    expect(openApiDocument.components?.schemas?.BreakthroughRun).toBeDefined();
    expect(openApiDocument.components?.schemas?.BreakthroughRunResponse).toBeDefined();
    expect(openApiDocument.components?.schemas?.SuccessEnvelopeBreakthroughRun).toBeDefined();
    expect(openApiDocument.components?.schemas?.SuccessEnvelopeActions).toBeDefined();
    expect(openApiDocument.components?.schemas?.SuccessEnvelopeRecipes).toBeDefined();
    expect(openApiDocument.components?.schemas?.ApiMeta).toMatchObject({
      properties: { state_version: { type: 'integer' } },
    });
    expect(openApiDocument.components?.schemas?.ErrorEnvelope).toBeDefined();
    expect(Object.keys(openApiDocument.paths).some((path) => path.includes('market'))).toBe(false);
  });
});
