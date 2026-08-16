import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ItemConfig, ConfigRegistry } from '@dongtian/config-schema';
import type { AssetBalance, AssetRepository } from '@dongtian/database';

import { AuthService } from '../auth/auth.service.js';
import { buildContentRouteIndexes, buildItemMetadata } from '../content/content-metadata.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { assetRepositoryToken } from './asset.tokens.js';

type InventoryQuery = {
  readonly category?: string;
};

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function integerQuantity(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('ASSET_QUANTITY_OUT_OF_RANGE');
  }
  return parsed;
}

function mapCurrency(balance: AssetBalance, category?: string): Record<string, unknown> {
  return {
    asset_type: balance.assetType,
    asset_id: balance.assetId,
    category,
    quantity: balance.assetType === 'ITEM' ? integerQuantity(balance.quantity) : balance.quantity,
    reserved_quantity:
      balance.assetType === 'ITEM' ? integerQuantity(balance.reservedQuantity) : balance.reservedQuantity,
    available_quantity:
      balance.assetType === 'ITEM' ? integerQuantity(balance.availableQuantity) : balance.availableQuantity,
    source_routes: [],
    usage_routes: [],
  };
}

@Injectable()
export class AssetService {
  public constructor(
    @Inject(assetRepositoryToken) private readonly repository: AssetRepository,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getInventory(
    request: FastifyRequest,
    characterId: string,
    query: InventoryQuery,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const inventory = await this.repository.getInventory(characterId, accountId);
    if (!inventory) {
      throw notFound();
    }

    const routeIndexes = buildContentRouteIndexes(this.configRegistry);
    const items = inventory.items.flatMap((item) => {
      let category: string | undefined;
      let configItem: ItemConfig | undefined;
      try {
        configItem = this.configRegistry.getItem(item.assetId);
        category = configItem.category;
      } catch {
        category = undefined;
        configItem = undefined;
      }
      if (query.category !== undefined && query.category.length > 0 && category !== query.category) {
        return [];
      }
      if (configItem) {
        return [
          buildItemMetadata(
            configItem,
            integerQuantity(item.quantity),
            integerQuantity(item.reservedQuantity),
            integerQuantity(item.availableQuantity),
            routeIndexes.sourceRoutesByItemId,
            routeIndexes.usageRoutesByItemId,
          ),
        ];
      }
      return [
        {
          asset_type: item.assetType,
          asset_id: item.assetId,
          quantity: integerQuantity(item.quantity),
          reserved_quantity: integerQuantity(item.reservedQuantity),
          available_quantity: integerQuantity(item.availableQuantity),
          source_routes: [],
          usage_routes: [],
          ...(category === undefined ? {} : { category }),
        } as Record<string, unknown>,
      ];
    });
    const currencies = inventory.currencies.map((currency) => mapCurrency(currency));

    return {
      items,
      currencies,
      equipment_instances: inventory.equipmentInstances.map((equipment) => ({
        instance_id: equipment.instanceId,
        item_id: equipment.itemId,
        temper_level: equipment.temperLevel,
        bound: equipment.bound,
        created_config_version: equipment.createdConfigVersion,
      })),
      total_count: items.length + currencies.length,
    };
  }
}
