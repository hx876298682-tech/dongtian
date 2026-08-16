import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { BuffService } from './buff.service.js';

@ApiTags('characters')
@Controller('characters')
export class BuffController {
  public constructor(@Inject(BuffService) private readonly buffService: BuffService) {}

  @Post(':character_id/buffs/use')
  @ApiOperation({ summary: '使用丹药 Buff' })
  @ApiBody({ schema: { $ref: '#/components/schemas/BuffUseRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeBuffUse' } })
  public use(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.buffService.use(request, characterId, body);
  }
}
