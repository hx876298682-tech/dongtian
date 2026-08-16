import { Module } from '@nestjs/common';

import { environmentProvider } from './environment.js';

@Module({
  providers: [environmentProvider],
  exports: [environmentProvider],
})
export class EnvironmentModule {}
