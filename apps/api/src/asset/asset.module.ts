import { Module } from '@nestjs/common';
import { createAssetRepository, type DatabasePool } from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { AssetController } from './asset.controller.js';
import { AssetMutationService } from './asset-mutation.service.js';
import { AssetService } from './asset.service.js';
import { assetRepositoryToken } from './asset.tokens.js';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [AssetController],
  providers: [
    {
      provide: assetRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createAssetRepository(pool),
    },
    AssetMutationService,
    AssetService,
  ],
  exports: [AssetMutationService, assetRepositoryToken],
})
export class AssetModule {}
