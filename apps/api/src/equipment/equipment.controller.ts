import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { EquipmentService } from './equipment.service.js';

@ApiTags('characters')
@Controller('characters')
export class EquipmentController {
  public constructor(@Inject(EquipmentService) private readonly equipmentService: EquipmentService) {}

  @Get(':character_id/loadouts/:preset_id')
  @ApiOperation({ summary: '读取装备预设' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' } })
  public getPreset(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('preset_id') presetId: string,
  ) {
    return this.equipmentService.getPreset(request, characterId, presetId);
  }

  @Put(':character_id/loadouts/:preset_id')
  @ApiOperation({ summary: '保存装备预设' })
  @ApiBody({ schema: { $ref: '#/components/schemas/LoadoutPresetSaveRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' } })
  public savePreset(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('preset_id') presetId: string,
    @Body() body: unknown,
  ) {
    return this.equipmentService.savePreset(request, characterId, presetId, body);
  }

  @Post(':character_id/loadouts/:preset_id/equip')
  @ApiOperation({ summary: '启用装备预设' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' } })
  public equipPreset(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('preset_id') presetId: string,
  ) {
    return this.equipmentService.equipPreset(request, characterId, presetId);
  }
}
