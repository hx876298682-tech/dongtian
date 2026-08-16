import { Module } from '@nestjs/common';

import { EnvironmentModule } from '../environment.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [EnvironmentModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
