import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

import { Module } from '@nestjs/common';

import { loadConfigRegistry, type Environment } from '@dongtian/config-schema';

import { EnvironmentModule } from '../environment.module.js';
import { environmentToken } from '../environment.js';
import { ConfigController } from './config.controller.js';
import { configRegistryToken } from './config.tokens.js';

function resolveReleasesRoot(storagePath: string): string {
  if (storagePath === './config/releases' || storagePath === 'config/releases') {
    return fileURLToPath(new URL('../../../../config/releases', import.meta.url));
  }

  return isAbsolute(storagePath) ? storagePath : resolve(process.cwd(), storagePath);
}

export const configRegistryProvider = {
  provide: configRegistryToken,
  useFactory: (environment: Environment) =>
    loadConfigRegistry({
      releasesRoot: resolveReleasesRoot(environment.CONFIG_STORAGE_PATH),
      version: environment.ACTIVE_CONFIG_VERSION,
    }),
  inject: [environmentToken],
};

@Module({
  imports: [EnvironmentModule],
  controllers: [ConfigController],
  providers: [configRegistryProvider],
  exports: [configRegistryProvider],
})
export class ConfigModule {}
