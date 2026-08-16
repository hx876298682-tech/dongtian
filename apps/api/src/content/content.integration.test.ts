import 'reflect-metadata';

import { Injectable, Module } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Injectable()
class MockContentService {
  public async getActions() {
    return { actions: [{ action_id: 'action.cultivation.qi' }], config_version: '2026.08.16.1', calculation_as_of: '2026-08-16T00:00:00.000Z' };
  }

  public async getRecipes() {
    return { recipes: [{ recipe_id: 'recipe.t1.qi_gathering_pill' }], config_version: '2026.08.16.1', calculation_as_of: '2026-08-16T00:00:00.000Z' };
  }

}

@Module({
  controllers: [ContentController],
  providers: [
    {
      provide: ContentService,
      useClass: MockContentService,
    },
  ],
})
class MockContentModule {}

describe('ContentController', () => {
  it('exposes the content routes used by the service layer', async () => {
    const app = await NestFactory.create(MockContentModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');

    try {
      await app.init();

      const actionsResponse = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/actions',
      });
      expect(actionsResponse.statusCode).toBe(200);
      expect(actionsResponse.json()).toMatchObject({ actions: [{ action_id: 'action.cultivation.qi' }] });

      const recipesResponse = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/recipes',
      });
      expect(recipesResponse.statusCode).toBe(200);
      expect(recipesResponse.json()).toMatchObject({ recipes: [{ recipe_id: 'recipe.t1.qi_gathering_pill' }] });
    } finally {
      await app.close();
    }
  });
});
