import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: '存活探针' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelope' } })
  public live(): { readonly status: 'ok' } {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪探针' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelope' } })
  @ApiServiceUnavailableResponse({ schema: { $ref: '#/components/schemas/ErrorEnvelope' } })
  public ready(): ReturnType<HealthService['ready']> {
    return this.healthService.ready();
  }
}
