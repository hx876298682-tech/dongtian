import { Module } from '@nestjs/common';
import { createEquipmentRepository, type DatabasePool } from '@dongtian/database';

import { AssetModule } from '../asset/asset.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { EquipmentController } from './equipment.controller.js';
import { EquipmentService } from './equipment.service.js';
import { equipmentRepositoryToken } from './equipment.tokens.js';

@Module({
  imports: [AuthModule, AssetModule, ConfigModule, SettlementModule],
  controllers: [EquipmentController],
  providers: [
    {
      provide: equipmentRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createEquipmentRepository(pool),
    },
    EquipmentService,
  ],
})
export class EquipmentModule {}
