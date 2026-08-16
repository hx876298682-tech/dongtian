import { Module } from '@nestjs/common';
import {
  createCharacterRepository,
  type DatabasePool,
} from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { ConfigModule } from '../config/config.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { CharacterController } from './character.controller.js';
import { CharacterService } from './character.service.js';
import { characterRepositoryToken } from './character.tokens.js';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [CharacterController],
  providers: [
    {
      provide: characterRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createCharacterRepository(pool),
    },
    CharacterService,
  ],
  exports: [characterRepositoryToken],
})
export class CharacterModule {}
