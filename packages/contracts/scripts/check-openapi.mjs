import { readFileSync } from 'node:fs';

const document = JSON.parse(readFileSync(new URL('../src/generated/openapi.json', import.meta.url), 'utf8'));
const requiredPaths = [
  '/api/v1/health/live',
  '/api/v1/health/ready',
  '/api/v1/config/manifest',
  '/api/v1/actions',
  '/api/v1/recipes',
  '/api/v1/characters/{character_id}/inventory',
  '/api/v1/characters/{character_id}/queue',
  '/api/v1/characters/{character_id}/queue/preview',
  '/api/v1/characters/{character_id}/queue/pause',
  '/api/v1/characters/{character_id}/queue/resume',
  '/api/v1/characters/{character_id}/breakthroughs/next',
  '/api/v1/characters/{character_id}/breakthroughs/preview',
  '/api/v1/characters/{character_id}/breakthroughs',
  '/api/v1/breakthrough-runs/{run_id}',
  '/api/v1/breakthrough-runs/{run_id}/choices',
  '/api/v1/breakthrough-runs/{run_id}/finalize',
  '/api/v1/breakthrough-runs/{run_id}/abandon',
  '/api/v1/characters/{character_id}/skill-tool-assignments',
  '/api/v1/characters/{character_id}/settlements/latest',
  '/api/v1/characters/{character_id}/settlements/{settlement_id}',
];

if (document.openapi !== '3.1.0') {
  throw new Error(`OPENAPI_VERSION_INVALID:${document.openapi}`);
}

for (const path of requiredPaths) {
  if (!(path in document.paths)) {
    throw new Error(`OPENAPI_PATH_MISSING:${path}`);
  }
}

if (!document.components?.schemas?.ErrorEnvelope) {
  throw new Error('OPENAPI_ERROR_ENVELOPE_MISSING');
}

if (!document.components?.schemas?.SuccessEnvelopeActions) {
  throw new Error('OPENAPI_ACTIONS_SCHEMA_MISSING');
}

if (!document.components?.schemas?.SuccessEnvelopeRecipes) {
  throw new Error('OPENAPI_RECIPES_SCHEMA_MISSING');
}

if (!document.components?.schemas?.SuccessEnvelopeSettlementSummary) {
  throw new Error('OPENAPI_SETTLEMENT_SUMMARY_SCHEMA_MISSING');
}

if (!document.components?.schemas?.SkillToolAssignmentsEnvelope) {
  throw new Error('OPENAPI_SKILL_TOOL_ASSIGNMENTS_SCHEMA_MISSING');
}

if (Object.keys(document.paths).some((path) => path.includes('market'))) {
  throw new Error('OPENAPI_MARKET_PATH_FORBIDDEN');
}

console.log(JSON.stringify({ status: 'compatible', openapi: document.openapi, paths: Object.keys(document.paths).length }));
