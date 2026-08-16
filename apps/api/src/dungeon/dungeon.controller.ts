import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { DungeonService } from './dungeon.service.js';

@ApiTags('dungeon')
@Controller('characters')
export class DungeonController {
  public constructor(@Inject(DungeonService) private readonly dungeonService: DungeonService) {}

  @Post('dungeons/:dungeon_id/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '预览秘境运行' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/DungeonPreviewResponse' } })
  public previewDungeon(
    @Req() request: FastifyRequest,
    @Param('dungeon_id') dungeonId: string,
    @Body() body: unknown,
  ) {
    return this.dungeonService.previewDungeon(request, dungeonId, body);
  }

  @Get(':character_id/dungeon-opportunities')
  @ApiOperation({ summary: '读取角色秘境机会' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonOpportunity' } })
  public getOpportunities(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.dungeonService.getOpportunities(request, characterId);
  }

  @Post(':character_id/dungeon-opportunities/teaching-grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '领取教学赠送的秘境机会' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonOpportunity' } })
  public claimTeachingGrant(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.dungeonService.claimTeachingGrant(request, characterId);
  }

  @Post(':character_id/dungeon-runs')
  @ApiOperation({ summary: '创建秘境运行并消耗一次机会' })
  @ApiBody({ schema: { $ref: '#/components/schemas/DungeonRunCreateRequest' } })
  @ApiCreatedResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' } })
  public enterDungeonRun(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.dungeonService.enterDungeonRun(request, characterId, body);
  }

  @Get('/dungeon-runs/:run_id')
  @ApiOperation({ summary: '读取秘境当前状态' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' } })
  public getDungeonRunById(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
  ) {
    return this.dungeonService.getDungeonRunById(request, runId);
  }

  @Get(':character_id/dungeon-runs/:run_id')
  @ApiOperation({ summary: '读取秘境运行' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' } })
  public getDungeonRun(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('run_id') runId: string,
  ) {
    return this.dungeonService.getDungeonRun(request, characterId, runId);
  }

  @Post('/dungeon-runs/:run_id/choices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '选择秘境路线' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' } })
  public chooseDungeonRun(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
    @Body() body: unknown,
  ) {
    return this.dungeonService.chooseDungeonRun(request, runId, body);
  }

  @Post('/dungeon-runs/:run_id/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '结算秘境运行' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' } })
  public finalizeDungeonRun(
    @Req() request: FastifyRequest,
    @Param('run_id') runId: string,
  ) {
    return this.dungeonService.finalizeDungeonRun(request, runId);
  }
}
