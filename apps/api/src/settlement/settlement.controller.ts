import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SettlementService } from './settlement.service.js';

@ApiTags('settlement')
@Controller('characters')
export class SettlementController {
  public constructor(@Inject(SettlementService) private readonly settlementService: SettlementService) {}

  @Get(':character_id/settlements/latest')
  @ApiOperation({ summary: '读取角色最近一次离线结算摘要' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeSettlementSummary' } })
  @ApiNotFoundResponse({ schema: { $ref: '#/components/schemas/ErrorEnvelope' } })
  public getLatest(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.settlementService.getLatestSettlementSummary(request, characterId);
  }

  @Get(':character_id/settlements/:settlement_id')
  @ApiOperation({ summary: '读取指定离线结算摘要' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeSettlementSummary' } })
  @ApiNotFoundResponse({ schema: { $ref: '#/components/schemas/ErrorEnvelope' } })
  public getById(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('settlement_id') settlementId: string,
  ) {
    return this.settlementService.getSettlementSummary(request, characterId, settlementId);
  }
}
