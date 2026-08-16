import { Module } from '@nestjs/common';
import { createSkillToolAssignmentRepository, type DatabasePool } from '@dongtian/database';

import { AssetModule } from '../asset/asset.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { SkillToolAssignmentsController } from './skill-tool-assignments.controller.js';
import { SkillToolAssignmentsService } from './skill-tool-assignments.service.js';
import { skillToolAssignmentRepositoryToken } from './skill-tool-assignments.tokens.js';

@Module({
  imports: [AuthModule, AssetModule, ConfigModule, SettlementModule],
  controllers: [SkillToolAssignmentsController],
  providers: [
    {
      provide: skillToolAssignmentRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createSkillToolAssignmentRepository(pool),
    },
    SkillToolAssignmentsService,
  ],
})
export class SkillToolAssignmentsModule {}
