import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { CharacterService } from './character.service.js';

@ApiTags('characters')
@Controller('characters')
export class CharacterController {
  public constructor(@Inject(CharacterService) private readonly characterService: CharacterService) {}

  @Get(':character_id/progression')
  @ApiOperation({ summary: '读取角色修为、百艺与功能权限' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeProgression' } })
  public progression(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.characterService.getProgression(request, characterId);
  }
}
