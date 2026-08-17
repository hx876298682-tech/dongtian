import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { BreakthroughService } from './breakthrough.service.js';

@ApiTags('breakthrough')
@Controller()
export class BreakthroughController {
  public constructor(@Inject(BreakthroughService) private readonly breakthroughService: BreakthroughService) {}

  @Get('characters/:character_id/breakthroughs/next')
  @ApiOperation({ summary: '读取筑基条件与来源' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughNext' } })
  public getNextBreakthrough(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.breakthroughService.getNextBreakthrough(request, characterId);
  }

  @Post('characters/:character_id/breakthroughs/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '预览筑基条件与消耗' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughPreview' } })
  public previewBreakthrough(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.breakthroughService.previewBreakthrough(request, characterId, body);
  }

  @Post('characters/:character_id/breakthroughs')
  @ApiCreatedResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughRun' } })
  @ApiOperation({ summary: '创建筑基试炼' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  public startBreakthrough(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.breakthroughService.startBreakthrough(request, characterId, body);
  }

  @Get('breakthrough-runs/:run_id')
  @ApiOperation({ summary: '读取筑基试炼状态' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughRun' } })
  public getBreakthroughRun(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
  ) {
    return this.breakthroughService.getBreakthroughRun(request, runId);
  }

  @Post('breakthrough-runs/:run_id/choices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '选择筑基试炼路线' })
  @ApiBody({ schema: { $ref: '#/components/schemas/BreakthroughChoiceRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughRun' } })
  public chooseBreakthroughRoute(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
    @Body() body: unknown,
  ) {
    return this.breakthroughService.chooseBreakthroughRoute(request, runId, body);
  }

  @Post('breakthrough-runs/:run_id/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '完成筑基试炼' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughRun' } })
  public finalizeBreakthroughRun(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
    @Body() body: unknown,
  ) {
    return this.breakthroughService.finalizeBreakthroughRun(request, runId, body);
  }

  @Post('breakthrough-runs/:run_id/abandon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '放弃筑基试炼' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBreakthroughRun' } })
  public abandonBreakthroughRun(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
    @Body() body: unknown,
  ) {
    return this.breakthroughService.abandonBreakthroughRun(request, runId, body);
  }
}
