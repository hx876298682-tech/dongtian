import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AssetService } from './asset.service.js';

@ApiTags('characters')
@Controller('characters')
export class AssetController {
  public constructor(@Inject(AssetService) private readonly assetService: AssetService) {}

  @Get(':character_id/inventory')
  @ApiOperation({ summary: '读取角色库存与可用资产' })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeInventory' } })
  public inventory(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Query('category') category?: string,
  ) {
    return this.assetService.getInventory(
      request,
      characterId,
      category === undefined ? {} : { category },
    );
  }
}
