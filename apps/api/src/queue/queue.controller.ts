import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { QueueService } from './queue.service.js';

@ApiTags('queue')
@Controller('characters')
export class QueueController {
  public constructor(@Inject(QueueService) private readonly queueService: QueueService) {}

  @Get(':character_id/queue')
  @ApiOperation({ summary: '读取角色闭关队列' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeQueue' } })
  public getQueue(@Req() request: FastifyRequest, @Param('character_id') characterId: string) {
    return this.queueService.getQueue(request, characterId);
  }

  @Post(':character_id/queue/preview')
  @ApiOperation({ summary: '预览闭关队列，不改变状态或资产' })
  @ApiBody({ schema: { $ref: '#/components/schemas/QueuePlanRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeQueuePreview' } })
  public preview(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.queueService.preview(request, characterId, body);
  }

  @Put(':character_id/queue')
  @ApiOperation({ summary: '保存闭关队列' })
  @ApiBody({ schema: { $ref: '#/components/schemas/QueuePlanRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeQueueMutation' } })
  public save(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.queueService.save(request, characterId, body);
  }

  @Post(':character_id/queue/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '在周期边界暂停闭关队列' })
  @ApiBody({ schema: { $ref: '#/components/schemas/QueueVersionRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeQueueMutation' } })
  public pause(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.queueService.pause(request, characterId, body);
  }

  @Post(':character_id/queue/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '恢复闭关队列' })
  @ApiBody({ schema: { $ref: '#/components/schemas/QueueVersionRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeQueueMutation' } })
  public resume(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.queueService.resume(request, characterId, body);
  }
}
