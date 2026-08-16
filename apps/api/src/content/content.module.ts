import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AssetModule } from '../asset/asset.module.js';
import { CharacterModule } from '../character/character.module.js';
import { ConfigModule } from '../config/config.module.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({
  imports: [AuthModule, ConfigModule, CharacterModule, AssetModule],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
