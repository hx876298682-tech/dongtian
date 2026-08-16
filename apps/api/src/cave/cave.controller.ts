import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { CaveService } from './cave.service.js';

@ApiTags('cave')
@Controller('characters')
export class CaveController {
  public constructor(@Inject(CaveService) private readonly caveService: CaveService) {}

  @Get(':character_id/cave')
  @ApiOperation({ summary: '读取角色洞府状态' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeCave' } })
  public getCave(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.caveService.getCave(request, characterId);
  }

  @Post(':character_id/cave/builds')
  @ApiOperation({ summary: '开建洞府设施' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CaveBuildRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeCave' } })
  public build(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.caveService.build(request, characterId, body);
  }
}
