import { Controller, Get, Inject, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ContentService } from './content.service.js';

@ApiTags('content')
@Controller()
export class ContentController {
  public constructor(@Inject(ContentService) private readonly contentService: ContentService) {}

  @Get('actions')
  @ApiOperation({ summary: '读取当前角色可见行动与来源用途' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeActions' } })
  public actions(@Req() request: FastifyRequest) {
    return this.contentService.getActions(request);
  }

  @Get('recipes')
  @ApiOperation({ summary: '读取当前角色可见配方与来源用途' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeRecipes' } })
  public recipes(@Req() request: FastifyRequest) {
    return this.contentService.getRecipes(request);
  }
}
