import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ConfigRegistry, type Manifest } from '@dongtian/config-schema';

import { configRegistryToken } from './config.tokens.js';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  public constructor(@Inject(configRegistryToken) private readonly registry: ConfigRegistry) {}

  @Get('manifest')
  @ApiOperation({ summary: '读取当前活动配置包 Manifest' })
  @ApiOkResponse({
    description: '当前配置版本的公开 Manifest。',
    schema: { $ref: '#/components/schemas/SuccessEnvelopeManifest' },
  })
  public manifest(): Manifest {
    return this.registry.manifest;
  }
}
