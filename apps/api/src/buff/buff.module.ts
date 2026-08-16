import { Module } from '@nestjs/common';

import { AssetModule } from '../asset/asset.module.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { BuffController } from './buff.controller.js';
import { BuffService } from './buff.service.js';

@Module({
  imports: [AssetModule, ConfigModule, SettlementModule],
  controllers: [BuffController],
  providers: [BuffService],
})
export class BuffModule {}
