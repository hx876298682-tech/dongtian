import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SkillToolAssignmentsService } from './skill-tool-assignments.service.js';

@ApiTags('characters')
@Controller('characters')
export class SkillToolAssignmentsController {
  public constructor(
    @Inject(SkillToolAssignmentsService) private readonly service: SkillToolAssignmentsService,
  ) {}

  @Get(':character_id/skill-tool-assignments')
  @ApiOperation({ summary: '读取角色工具分配与工具对比' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SkillToolAssignmentsEnvelope' } })
  public getAssignments(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
  ) {
    return this.service.getAssignments(request, characterId);
  }

  @Put(':character_id/skill-tool-assignments')
  @ApiOperation({ summary: '保存角色工具分配' })
  @ApiBody({ schema: { $ref: '#/components/schemas/SkillToolAssignmentsSaveRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SkillToolAssignmentsEnvelope' } })
  public saveAssignments(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Body() body: unknown,
  ) {
    return this.service.saveAssignments(request, characterId, body);
  }
}
