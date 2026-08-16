import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { TemperingService } from './tempering.service.js';

@ApiTags('characters')
@Controller('characters')
export class TemperingController {
  public constructor(@Inject(TemperingService) private readonly temperingService: TemperingService) {}

  @Post(':character_id/equipment/:instance_id/temper')
  @ApiOperation({ summary: '装备淬炼' })
  @ApiBody({ schema: { $ref: '#/components/schemas/TemperEquipmentRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/TemperEquipmentEnvelope' } })
  public temper(
    @Req() request: FastifyRequest,
    @Param('character_id') characterId: string,
    @Param('instance_id') instanceId: string,
    @Body() body: unknown,
  ) {
    return this.temperingService.temperEquipment(request, characterId, instanceId, body);
  }
}
